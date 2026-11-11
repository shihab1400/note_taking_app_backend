// Vercel serverless entry point. vercel.json rewrites every /api/* request here;
// Express receives the original URL and routes it.
import { app } from '../src/app.js';

export default app;
