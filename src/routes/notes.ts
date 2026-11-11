import { Router } from 'express';
import { z } from 'zod';
import { NoteModel } from '../models/Note.js';
import { requireAuth, currentUser, type AuthUser } from '../middleware/auth.js';
import { notFound } from '../utils/httpError.js';
import { paginationSchema, paged, toPagination } from '../utils/pagination.js';
import { parse, idParams } from '../utils/validation.js';
import type { Types } from 'mongoose';

export const notesRouter = Router();
notesRouter.use(requireAuth);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(20_000).default(''),
});
const updateSchema = createSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

/** Loads a note by _id (default index) and enforces ownership. */
async function loadNote(id: Types.ObjectId, user: AuthUser, opts: { allowAdmin: boolean }) {
  const note = await NoteModel.findById(id);
  if (!note) throw notFound('Note not found');
  const isOwner = note.owner.equals(user.id);
  if (!isOwner && !(opts.allowAdmin && user.role === 'admin')) {
    // Respond 404 rather than 403 so note ids belonging to others can't be probed.
    throw notFound('Note not found');
  }
  return note;
}

// List MY notes. Index: notes { owner: 1, _id: -1 } (filter + sort + count).
notesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const p = toPagination(parse(paginationSchema, req.query));
  const filter = { owner: user.id };
  const [data, total] = await Promise.all([
    NoteModel.find(filter).sort({ _id: -1 }).skip(p.skip).limit(p.limit).lean(),
    NoteModel.countDocuments(filter),
  ]);
  res.json(paged(data, p, total));
});

notesRouter.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const note = await NoteModel.create({ ...body, owner: currentUser(req).id });
  res.status(201).json({ note });
});

// Admins may view any note (they can view everyone's notes); everyone else only their own.
notesRouter.get('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const note = await loadNote(id, currentUser(req), { allowAdmin: true });
  res.json({ note });
});

// Modifying is owner-only; admins have read access to others' notes, not write.
notesRouter.patch('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(updateSchema, req.body);
  const note = await loadNote(id, currentUser(req), { allowAdmin: false });
  note.set(body);
  await note.save();
  res.json({ note });
});

notesRouter.delete('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const note = await loadNote(id, currentUser(req), { allowAdmin: false });
  await note.deleteOne();
  res.status(204).end();
});
