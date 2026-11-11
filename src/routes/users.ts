import { Router } from 'express';
import { z } from 'zod';
import { UserModel } from '../models/User.js';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { badRequest, unauthorized } from '../utils/httpError.js';
import { parse, name, interests, password } from '../utils/validation.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const updateMeSchema = z
  .object({
    name: name.optional(),
    interests: interests.optional(),
    currentPassword: z.string().max(72).optional(),
    newPassword: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

// Update own profile (name, interests, password). Reads by _id (default index).
usersRouter.patch('/me', async (req, res) => {
  const body = parse(updateMeSchema, req.body);
  const user = await UserModel.findById(currentUser(req).id).select('+passwordHash');
  if (!user) throw unauthorized();

  if (body.name !== undefined) user.name = body.name;
  if (body.interests !== undefined) user.set('interests', body.interests);
  if (body.newPassword !== undefined) {
    if (!body.currentPassword) throw badRequest('currentPassword is required to change password');
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw unauthorized('Current password is incorrect');
    }
    user.passwordHash = await hashPassword(body.newPassword);
  }

  await user.save();
  res.json({ user });
});
