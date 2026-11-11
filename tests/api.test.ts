import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/db/connect.js';
import { UserModel } from '../src/models/User.js';
import { NoteModel } from '../src/models/Note.js';
import { PostModel } from '../src/models/Post.js';
import { hashPassword } from '../src/utils/password.js';
import { runExplainChecks } from '../scripts/explainChecks.js';

let mongod: MongoMemoryServer;

type Agent = ReturnType<typeof request.agent>;
const agent = () => request.agent(app);

async function register(a: Agent, name: string, email: string, interests: string[] = []) {
  const res = await a.post('/api/auth/register').send({ name, email, password: 'password123', interests });
  expect(res.status).toBe(201);
  return res.body.user as { _id: string };
}

let alice: Agent, bob: Agent, admin: Agent, anon: Agent;
let aliceId: string, bobId: string, adminId: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await connectDB(mongod.getUri('notes_test'));
  await Promise.all([UserModel.createIndexes(), NoteModel.createIndexes(), PostModel.createIndexes()]);

  alice = agent();
  bob = agent();
  admin = agent();
  anon = agent();
  aliceId = (await register(alice, 'Alice', 'alice@example.com', ['Chess', 'reading']))._id;
  bobId = (await register(bob, 'Bob', 'bob@example.com', ['chess']))._id;

  const adminUser = await UserModel.create({
    name: 'Root',
    email: 'root@example.com',
    role: 'admin',
    passwordHash: await hashPassword('adminpass123'),
  });
  adminId = adminUser.id;
  const login = await admin.post('/api/auth/login').send({ email: 'root@example.com', password: 'adminpass123' });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await disconnectDB();
  await mongod?.stop();
});

describe('auth', () => {
  it('sets an httpOnly cookie and never returns the password hash', async () => {
    const res = await anon.post('/api/auth/register').send({ name: 'Carol', email: 'carol@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Strict/i);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.role).toBe('user');
  });

  it('ignores a role sent during registration', async () => {
    const res = await agent().post('/api/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'password123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  it('rejects duplicate emails with 409', async () => {
    const res = await agent().post('/api/auth/register').send({ name: 'A2', email: 'ALICE@example.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('rejects wrong passwords and NoSQL-injection payloads', async () => {
    expect((await agent().post('/api/auth/login').send({ email: 'alice@example.com', password: 'nope-nope' })).status).toBe(401);
    expect((await agent().post('/api/auth/login').send({ email: { $gt: '' }, password: 'x' })).status).toBe(400);
  });

  it('requires auth for /me and logs out', async () => {
    expect((await agent().get('/api/auth/me')).status).toBe(401);
    expect((await alice.get('/api/auth/me')).body.user.email).toBe('alice@example.com');
    const a = agent();
    await a.post('/api/auth/login').send({ email: 'bob@example.com', password: 'password123' });
    expect((await a.post('/api/auth/logout')).status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects non-JSON mutating requests (CSRF defence)', async () => {
    const res = await alice.post('/api/notes').type('form').send('title=hack');
    expect(res.status).toBe(400);
  });
});

describe('notes (user)', () => {
  let noteId: string;

  it('creates, reads, updates and deletes own notes', async () => {
    const created = await alice.post('/api/notes').send({ title: 'First', content: 'hello' });
    expect(created.status).toBe(201);
    noteId = created.body.note._id;

    expect((await alice.get(`/api/notes/${noteId}`)).body.note.title).toBe('First');
    const upd = await alice.patch(`/api/notes/${noteId}`).send({ title: 'Updated' });
    expect(upd.body.note.title).toBe('Updated');
  });

  it('paginates the list, newest first', async () => {
    for (let i = 0; i < 25; i++) await alice.post('/api/notes').send({ title: `n${i}` });
    const p1 = await alice.get('/api/notes?page=1&limit=10');
    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.total).toBe(26);
    expect(p1.body.totalPages).toBe(3);
    expect(p1.body.data[0].title).toBe('n24');
    const p3 = await alice.get('/api/notes?page=3&limit=10');
    expect(p3.body.data).toHaveLength(6);
    expect((await alice.get('/api/notes?limit=1000')).status).toBe(400);
  });

  it("cannot see or modify another user's notes", async () => {
    expect((await bob.get(`/api/notes/${noteId}`)).status).toBe(404);
    expect((await bob.patch(`/api/notes/${noteId}`).send({ title: 'x' })).status).toBe(404);
    expect((await bob.delete(`/api/notes/${noteId}`)).status).toBe(404);
    expect((await bob.get('/api/notes')).body.total).toBe(0);
  });

  it('rejects invalid ids', async () => {
    expect((await alice.get('/api/notes/not-an-id')).status).toBe(400);
  });

  it('deletes own note', async () => {
    expect((await alice.delete(`/api/notes/${noteId}`)).status).toBe(204);
    expect((await alice.get(`/api/notes/${noteId}`)).status).toBe(404);
  });
});

describe('admin', () => {
  it('blocks normal users from admin routes', async () => {
    expect((await alice.get('/api/admin/users')).status).toBe(403);
    expect((await agent().get('/api/admin/users')).status).toBe(401);
  });

  it("lists users and everyone's notes (paginated)", async () => {
    const users = await admin.get('/api/admin/users?limit=2');
    expect(users.status).toBe(200);
    expect(users.body.data).toHaveLength(2);
    expect(users.body.data[0].passwordHash).toBeUndefined();

    const notes = await admin.get(`/api/admin/notes?userId=${aliceId}&limit=5`);
    expect(notes.body.total).toBe(25);
    expect(notes.body.data[0].owner.name).toBe('Alice');

    const anyNote = notes.body.data[0]._id;
    expect((await admin.get(`/api/notes/${anyNote}`)).status).toBe(200);
  });

  it('adds, updates and removes users; cascades their data', async () => {
    const created = await admin.post('/api/admin/users').send({ name: 'Dan', email: 'dan@example.com', password: 'password123' });
    expect(created.status).toBe(201);
    const danId = created.body.user._id;

    const upd = await admin.patch(`/api/admin/users/${danId}`).send({ role: 'admin', interests: ['Go'] });
    expect(upd.body.user.role).toBe('admin');
    expect(upd.body.user.interests).toEqual(['go']);

    const dan = agent();
    await dan.post('/api/auth/login').send({ email: 'dan@example.com', password: 'password123' });
    await dan.post('/api/notes').send({ title: 'dan note' });
    await dan.post('/api/posts').send({ title: 'dan post' });

    expect((await admin.delete(`/api/admin/users/${danId}`)).status).toBe(204);
    expect(await NoteModel.countDocuments({ owner: danId })).toBe(0);
    expect(await PostModel.countDocuments({ author: danId })).toBe(0);
    // Deleted user's still-valid JWT stops working immediately.
    expect((await dan.get('/api/notes')).status).toBe(401);
  });

  it('prevents admins from deleting or demoting themselves', async () => {
    expect((await admin.delete(`/api/admin/users/${adminId}`)).status).toBe(400);
    expect((await admin.patch(`/api/admin/users/${adminId}`).send({ role: 'user' })).status).toBe(400);
  });
});

describe('aggregations', () => {
  it('Scenario 1: groups users by interest', async () => {
    const res = await admin.get('/api/admin/interests');
    expect(res.status).toBe(200);
    const chess = res.body.data.find((g: { interest: string }) => g.interest === 'chess');
    expect(chess.count).toBe(2);
    expect(chess.users.map((u: { name: string }) => u.name).sort()).toEqual(['Alice', 'Bob']);
    expect(res.body.data[0].interest).toBe('chess'); // sorted by count desc

    const single = await admin.get('/api/admin/interests?interest=reading');
    expect(single.body.data).toEqual([{ interest: 'reading', count: 1, users: [{ _id: aliceId, name: 'Alice' }] }]);
  });

  it('Scenario 2: returns a user\'s posts publicly via $lookup', async () => {
    for (let i = 0; i < 3; i++) await bob.post('/api/posts').send({ title: `post ${i}` });
    const res = await anon.get(`/api/posts/user/${bobId}?limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.author).toEqual({ _id: bobId, name: 'Bob' });
    expect(res.body.data.map((p: { title: string }) => p.title)).toEqual(['post 2', 'post 1']);
    expect(res.body.hasMore).toBe(true);
    const p2 = await anon.get(`/api/posts/user/${bobId}?limit=2&page=2`);
    expect(p2.body.hasMore).toBe(false);
    expect(res.body.author.email).toBeUndefined();
    expect((await anon.get('/api/posts/user/507f1f77bcf86cd799439011')).status).toBe(404);
  });

  it('only the author can delete a post', async () => {
    const post = (await bob.post('/api/posts').send({ title: 'mine' })).body.post;
    expect((await alice.delete(`/api/posts/${post._id}`)).status).toBe(404);
    expect((await bob.delete(`/api/posts/${post._id}`)).status).toBe(204);
  });
});

describe('indexes', () => {
  it('declares exactly the minimal index set', async () => {
    const keys = async (m: typeof UserModel | typeof NoteModel | typeof PostModel) =>
      (await m.collection.indexes()).map((i) => JSON.stringify(i.key)).sort();
    expect(await keys(UserModel)).toEqual(['{"_id":1}', '{"email":1}', '{"interests":1}']);
    expect(await keys(NoteModel)).toEqual(['{"_id":1}', '{"owner":1,"_id":-1}']);
    expect(await keys(PostModel)).toEqual(['{"_id":1}', '{"author":1,"_id":-1}']);
  });

  it('every query and aggregation is index-backed (no COLLSCAN)', async () => {
    const results = await runExplainChecks();
    const failures = results.filter((r) => !r.ok);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
});
