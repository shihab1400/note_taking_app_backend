import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../utils/httpError.js';
import { isProd } from '../config/env.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  // Malformed JSON body / payload too large (from express.json)
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  if (err?.code === 11000) {
    res.status(409).json({ error: 'A record with that value already exists' });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: `Invalid value for ${err.path}` });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error', ...(isProd ? {} : { message: String(err?.message ?? err) }) });
};
