// Usage: npm run sync-indexes
// Makes the database's indexes match exactly what the schemas declare with schema.index():
// creates missing ones and DROPS any index not declared (keeps the index set minimal).
import { connectDB, disconnectDB } from '../src/db/connect.js';
import { UserModel } from '../src/models/User.js';
import { NoteModel } from '../src/models/Note.js';
import { PostModel } from '../src/models/Post.js';

await connectDB();

for (const Model of [UserModel, NoteModel, PostModel]) {
  const dropped = await Model.syncIndexes();
  const indexes = await Model.collection.indexes();
  console.log(`${Model.collection.collectionName}:`);
  for (const ix of indexes) console.log(`  ${ix.name}  ${JSON.stringify(ix.key)}${ix.unique ? ' (unique)' : ''}`);
  if (dropped.length) console.log(`  dropped: ${dropped.join(', ')}`);
}

await disconnectDB();
