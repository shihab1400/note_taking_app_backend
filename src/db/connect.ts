import mongoose from 'mongoose';
import { env, isProd } from '../config/env.js';

// Global Mongoose settings.
mongoose.set('strictQuery', true);
// Strips query-selector objects (e.g. { $gt: '' }) from user input in filters -> blocks NoSQL injection.
mongoose.set('sanitizeFilter', true);
// Indexes are applied explicitly with `npm run sync-indexes` in production,
// so cold starts on Vercel never trigger index builds.
mongoose.set('autoIndex', !isProd);

type Cache = { promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as unknown as { __mongoose?: Cache };
const cache: Cache = globalForMongoose.__mongoose ?? (globalForMongoose.__mongoose = { promise: null });

/**
 * Serverless-safe connection: reuses one connection across warm invocations
 * of the same Vercel function instance.
 */
export async function connectDB(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
      })
      .catch((err) => {
        cache.promise = null; // allow a retry on the next request
        throw err;
      });
  }
  return cache.promise;
}

export async function disconnectDB(): Promise<void> {
  cache.promise = null;
  await mongoose.disconnect();
}
