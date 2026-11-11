// Runs explain() on every query / aggregation the API issues and reports which
// index each one uses. A check fails if any plan contains a COLLSCAN, or if the
// $lookup sub-pipeline scanned the posts collection without an index.
import type { Types } from 'mongoose';
import { UserModel } from '../src/models/User.js';
import { NoteModel } from '../src/models/Note.js';
import { PostModel } from '../src/models/Post.js';
import { interestGroupsPipeline, userPostsPipeline } from '../src/services/aggregations.js';
import { toPagination } from '../src/utils/pagination.js';

export interface CheckResult {
  name: string;
  ok: boolean;
  stages: string[];
  indexes: string[];
  note?: string;
}

/** Recursively collect every `stage`, `indexName` and $lookup `indexesUsed` from an explain doc. */
function walk(node: unknown, acc: { stages: Set<string>; indexes: Set<string>; lookupCollScans: number }) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, acc));
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.stage === 'string') acc.stages.add(obj.stage);
  if (typeof obj.indexName === 'string') acc.indexes.add(obj.indexName);
  if (Array.isArray(obj.indexesUsed)) obj.indexesUsed.forEach((i) => acc.indexes.add(`lookup:${String(i)}`));
  if (typeof obj.collectionScans === 'number') acc.lookupCollScans += obj.collectionScans;
  // Ignore rejected plans: only the winning plan matters.
  for (const [k, v] of Object.entries(obj)) if (k !== 'rejectedPlans') walk(v, acc);
}

function evaluate(name: string, explain: unknown, opts: { expectLookupIndex?: boolean } = {}): CheckResult {
  const acc = { stages: new Set<string>(), indexes: new Set<string>(), lookupCollScans: 0 };
  walk(explain, acc);
  const stages = [...acc.stages];
  const indexes = [...acc.indexes];
  const usesIdIndex = stages.some((s) => s === 'IDHACK' || s.startsWith('EXPRESS_'));
  let ok = !stages.includes('COLLSCAN') && acc.lookupCollScans === 0 && (indexes.length > 0 || usesIdIndex);
  let note: string | undefined;
  if (opts.expectLookupIndex && !indexes.some((i) => i.startsWith('lookup:'))) {
    ok = false;
    note = '$lookup did not report an index';
  }
  return { name, ok, stages, indexes, note };
}

export async function runExplainChecks(): Promise<CheckResult[]> {
  // Temporary fixture data so every plan (incl. the $lookup) actually executes.
  const tag = `explain-${Date.now()}`;
  const user = await UserModel.create({
    name: 'Explain Probe',
    email: `${tag}@probe.local`,
    passwordHash: 'x',
    interests: [`${tag}-a`, `${tag}-b`],
  });
  const note = await NoteModel.create({ owner: user._id, title: 'probe' });
  await PostModel.create({ author: user._id, title: 'probe' });
  const uid = user._id as Types.ObjectId;
  const p = toPagination({ page: 1, limit: 20 });

  try {
    const results: CheckResult[] = [];
    const ex = async (name: string, promise: Promise<unknown>, opts?: { expectLookupIndex?: boolean }) =>
      results.push(evaluate(name, await promise, opts));

    // --- Auth -----------------------------------------------------------
    await ex('login/register: users.findOne({ email })', UserModel.findOne({ email: user.email }).explain('executionStats'));
    await ex('auth middleware / profile: users.findById', UserModel.findById(uid).explain('executionStats'));

    // --- Notes ----------------------------------------------------------
    await ex(
      'my notes list: notes.find({ owner }).sort({ _id: -1 })',
      NoteModel.find({ owner: uid }).sort({ _id: -1 }).skip(p.skip).limit(p.limit).explain('executionStats'),
    );
    await ex(
      'my notes count: notes.countDocuments({ owner })',
      NoteModel.collection
        .aggregate([{ $match: { owner: uid } }, { $group: { _id: 1, n: { $sum: 1 } } }])
        .explain('executionStats'),
    );
    await ex('note by id: notes.findById', NoteModel.findById(note._id).explain('executionStats'));

    // --- Admin ----------------------------------------------------------
    await ex(
      'admin users list: users.find().sort({ _id: -1 })',
      UserModel.find().sort({ _id: -1 }).skip(p.skip).limit(p.limit).explain('executionStats'),
    );
    await ex(
      'admin all notes: notes.find().sort({ _id: -1 })',
      NoteModel.find().sort({ _id: -1 }).skip(p.skip).limit(p.limit).explain('executionStats'),
    );
    await ex(
      'admin cascade delete: notes.deleteMany({ owner })',
      NoteModel.collection.find({ owner: uid }).explain('executionStats'),
    );
    await ex(
      'admin cascade delete: posts.deleteMany({ author })',
      PostModel.collection.find({ author: uid }).explain('executionStats'),
    );

    // --- Aggregations ---------------------------------------------------
    await ex(
      'Scenario 1: users grouped by interests',
      UserModel.collection.aggregate(interestGroupsPipeline(p)).explain('executionStats'),
    );
    await ex(
      'Scenario 1: single interest group',
      UserModel.collection.aggregate(interestGroupsPipeline(p, `${tag}-a`)).explain('executionStats'),
    );
    await ex(
      'Scenario 2: user posts via $lookup',
      UserModel.collection.aggregate(userPostsPipeline(uid, p)).explain('executionStats'),
      { expectLookupIndex: true },
    );

    return results;
  } finally {
    await Promise.all([
      UserModel.deleteOne({ _id: uid }),
      NoteModel.deleteMany({ owner: uid }),
      PostModel.deleteMany({ author: uid }),
    ]);
  }
}

export function printResults(results: CheckResult[]) {
  for (const r of results) {
    const where = r.indexes.length ? r.indexes.join(', ') : r.stages.filter((s) => s.includes('ID') || s.startsWith('EXPRESS')).join(', ');
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n      stages: ${r.stages.join(' > ')}\n      index:  ${where || '-'}${r.note ? `\n      note:   ${r.note}` : ''}`);
  }
}
