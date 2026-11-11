import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { UserModel, type Role } from '../models/User.js';
import { AUTH_COOKIE, clearAuthCookie, verifyToken } from '../utils/jwt.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

export interface AuthUser {
  id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Verifies the JWT from the httpOnly cookie, then reloads the user by _id (default index)
 * so that role changes and deletions take effect immediately, not when the token expires.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[AUTH_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthorized();

  let userId: string;
  try {
    userId = verifyToken(token).sub;
  } catch {
    clearAuthCookie(res);
    throw unauthorized('Invalid or expired session');
  }
  if (!Types.ObjectId.isValid(userId)) throw unauthorized('Invalid session');

  const user = await UserModel.findById(userId).select('name email role').lean();
  if (!user) {
    clearAuthCookie(res);
    throw unauthorized('Account no longer exists');
  }

  req.user = { id: user._id, name: user.name, email: user.email, role: user.role as Role };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden('Insufficient permissions');
    next();
  };
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
