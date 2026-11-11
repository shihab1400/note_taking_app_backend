import { Router } from 'express';
import { z } from 'zod';
import { PostModel } from '../models/Post.js';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { getUserPosts } from '../services/aggregations.js';
import { notFound } from '../utils/httpError.js';
import { paginationSchema, toPagination } from '../utils/pagination.js';
import { parse, idParams, objectId } from '../utils/validation.js';

export const postsRouter = Router();

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(''),
});

// PUBLIC: all posts of one user. Scenario 2 aggregation ($lookup).
postsRouter.get('/user/:userId', async (req, res) => {
  const { userId } = parse(z.object({ userId: objectId }), req.params);
  const p = toPagination(parse(paginationSchema, req.query));
  const result = await getUserPosts(userId, p);
  if (!result) throw notFound('User not found');
  res.json(result);
});

postsRouter.post('/', requireAuth, async (req, res) => {
  const body = parse(createSchema, req.body);
  const post = await PostModel.create({ ...body, author: currentUser(req).id });
  res.status(201).json({ post });
});

// Author (or admin, as a moderation action) can delete a post. Read by _id (default index).
postsRouter.delete('/:id', requireAuth, async (req, res) => {
  const { id } = parse(idParams, req.params);
  const user = currentUser(req);
  const post = await PostModel.findById(id);
  if (!post || (!post.author.equals(user.id) && user.role !== 'admin')) throw notFound('Post not found');
  await post.deleteOne();
  res.status(204).end();
});
