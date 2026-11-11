import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { UserModel } from '../models/User.js';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../utils/password.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../utils/jwt.js';
import { conflict, unauthorized } from '../utils/httpError.js';
import { parse, email, password, name, interests } from '../utils/validation.js';
import { isProd } from '../config/env.js';

export const authRouter = Router();

// Brute-force protection on credential endpoints.
// Note: on serverless this window is per function instance.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 20 : 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const registerSchema = z.object({ name, email, password, interests: interests.optional() });
const loginSchema = z.object({ email, password: z.string().min(1).max(72) });

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
  // Uses the unique { email: 1 } index.
  if (await UserModel.exists({ email: body.email })) throw conflict('Email is already registered');

  // Role is never taken from input: self-registration always creates a plain user.
  const user = await UserModel.create({
    name: body.name,
    email: body.email,
    passwordHash: await hashPassword(body.password),
    interests: body.interests ?? [],
    role: 'user',
  });

  setAuthCookie(res, signToken(user.id));
  res.status(201).json({ user });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  // Uses the unique { email: 1 } index.
  const user = await UserModel.findOne({ email: body.email }).select('+passwordHash');

  if (!user) {
    await burnPasswordCheck(body.password);
    throw unauthorized('Invalid email or password');
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw unauthorized('Invalid email or password');
  }

  setAuthCookie(res, signToken(user.id));
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

// Current user's full profile, read by _id (default index).
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await UserModel.findById(currentUser(req).id);
  res.json({ user });
});
