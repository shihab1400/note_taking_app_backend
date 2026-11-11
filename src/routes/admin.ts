import { Router } from 'express';
import { z } from 'zod';
import { UserModel, ROLES } from '../models/User.js';
import { NoteModel } from '../models/Note.js';
import { PostModel } from '../models/Post.js';
import { requireAuth, requireRole, currentUser } from '../middleware/auth.js';
import { getUsersGroupedByInterest } from '../services/aggregations.js';
import { hashPassword } from '../utils/password.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { paginationSchema, paged, toPagination } from '../utils/pagination.js';
import { parse, idParams, objectId, email, password, name, interests } from '../utils/validation.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const role = z.enum(ROLES);
const createUserSchema = z.object({
  name,
  email,
  password,
  role: role.default('user'),
  interests: interests.default([]),
});
const updateUserSchema = z
  .object({ name, email, password, role, interests })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// List all users. Sorted by _id desc -> served by the default _id index.
adminRouter.get('/users', async (req, res) => {
  const p = toPagination(parse(paginationSchema, req.query));
  const [data, total] = await Promise.all([
    UserModel.find().sort({ _id: -1 }).skip(p.skip).limit(p.limit).lean(),
    UserModel.estimatedDocumentCount(),
  ]);
  res.json(paged(data, p, total));
});

adminRouter.post('/users', async (req, res) => {
  const body = parse(createUserSchema, req.body);
  if (await UserModel.exists({ email: body.email })) throw conflict('Email is already registered');
  const user = await UserModel.create({
    name: body.name,
    email: body.email,
    role: body.role,
    interests: body.interests,
    passwordHash: await hashPassword(body.password),
  });
  res.status(201).json({ user });
});

// Read by _id (default index).
adminRouter.get('/users/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const user = await UserModel.findById(id);
  if (!user) throw notFound('User not found');
  res.json({ user });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(updateUserSchema, req.body);
  const me = currentUser(req);

  if (me.id.equals(id) && body.role && body.role !== 'admin') {
    throw badRequest('You cannot remove your own admin role');
  }

  const user = await UserModel.findById(id);
  if (!user) throw notFound('User not found');

  if (body.email && body.email !== user.email) {
    if (await UserModel.exists({ email: body.email })) throw conflict('Email is already registered');
    user.email = body.email;
  }
  if (body.name !== undefined) user.name = body.name;
  if (body.role !== undefined) user.role = body.role;
  if (body.interests !== undefined) user.set('interests', body.interests);
  if (body.password !== undefined) user.passwordHash = await hashPassword(body.password);

  await user.save();
  res.json({ user });
});

// Delete a user and everything they own.
// deleteMany uses notes { owner, _id } and posts { author, _id } indexes.
adminRouter.delete('/users/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  if (currentUser(req).id.equals(id)) throw badRequest('You cannot delete your own account');

  const deleted = await UserModel.findByIdAndDelete(id);
  if (!deleted) throw notFound('User not found');
  await Promise.all([NoteModel.deleteMany({ owner: id }), PostModel.deleteMany({ author: id })]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Everyone's notes
// ---------------------------------------------------------------------------

// ?userId=  -> notes { owner: 1, _id: -1 } index
// no filter -> default _id index (sort by _id desc)
// owner populate -> users by _id (default index)
adminRouter.get('/notes', async (req, res) => {
  const q = parse(paginationSchema.extend({ userId: objectId.optional() }), req.query);
  const p = toPagination(q);
  const filter = q.userId ? { owner: q.userId } : {};
  const [data, total] = await Promise.all([
    NoteModel.find(filter)
      .sort({ _id: -1 })
      .skip(p.skip)
      .limit(p.limit)
      .populate('owner', 'name email')
      .lean(),
    q.userId ? NoteModel.countDocuments(filter) : NoteModel.estimatedDocumentCount(),
  ]);
  res.json(paged(data, p, total));
});

// ---------------------------------------------------------------------------
// Scenario 1 aggregation: users grouped by interest (optionally a single interest)
// ---------------------------------------------------------------------------
adminRouter.get('/interests', async (req, res) => {
  const q = parse(
    paginationSchema.extend({ interest: z.string().trim().toLowerCase().min(1).max(50).optional() }),
    req.query,
  );
  const p = toPagination(q);
  const { data, total } = await getUsersGroupedByInterest(p, q.interest);
  res.json(paged(data, p, total));
});
