// Local development server for the API. The frontend lives in its own repo and
// proxies /api/* to this server (see the frontend's dev-server.mjs).
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDB } from './db/connect.js';

await connectDB();
app.listen(env.PORT, () => {
  console.log(`API running at http://localhost:${env.PORT}/api`);
});
