import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { connectDB } from './db/connect.js';
import { authRouter } from './routes/auth.js';
import { notesRouter } from './routes/notes.js';
import { usersRouter } from './routes/users.js';
import { postsRouter } from './routes/posts.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { badRequest } from './utils/httpError.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Vercel sits in front: needed for correct client IPs in rate limiting
  app.set('query parser', 'simple'); // no nested objects from query strings

  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // CSRF defence-in-depth (on top of SameSite=Strict cookies): state-changing
  // requests must send JSON, which a cross-site HTML form cannot do.
  api.use((req, _res, next) => {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
    if (mutating && hasBody && !req.is('application/json')) {
      throw badRequest('Content-Type must be application/json');
    }
    next();
  });

  // Lazily connect (cached across warm serverless invocations).
  api.use(async (_req, _res, next) => {
    await connectDB();
    next();
  });

  api.use('/auth', authRouter);
  api.use('/notes', notesRouter);
  api.use('/users', usersRouter);
  api.use('/posts', postsRouter);
  api.use('/admin', adminRouter);

  app.use('/api', api);
  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
