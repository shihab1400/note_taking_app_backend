// Usage: npm run explain
// Proves every API query/aggregation is index-backed against the DB in MONGODB_URI.
import { connectDB, disconnectDB } from '../src/db/connect.js';
import { UserModel } from '../src/models/User.js';
import { NoteModel } from '../src/models/Note.js';
import { PostModel } from '../src/models/Post.js';
import { printResults, runExplainChecks } from './explainChecks.js';

await connectDB();
// Make sure the declared indexes exist before explaining (no-op if already synced).
await Promise.all([UserModel.createIndexes(), NoteModel.createIndexes(), PostModel.createIndexes()]);

const results = await runExplainChecks();
printResults(results);
await disconnectDB();

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
