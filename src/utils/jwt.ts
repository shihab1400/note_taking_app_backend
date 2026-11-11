import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Response, CookieOptions } from 'express';
import { env, isProd } from '../config/env.js';

export const AUTH_COOKIE = 'token';

export interface TokenPayload {
  sub: string;
}

export function signToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, {
    subject: userId,
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Invalid token payload');
  return { sub: decoded.sub };
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
  };
}

export function setAuthCookie(res: Response, token: string): void {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const maxAge = decoded?.exp ? decoded.exp * 1000 - Date.now() : undefined;
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions(), maxAge });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}
