import type { PipelineStage, Types } from 'mongoose';
import { UserModel } from '../models/User.js';
import { PostModel } from '../models/Post.js';
import type { Pagination } from '../utils/pagination.js';

// ===========================================================================
// Scenario 1: users grouped by interest
// Exactly ONE collection.aggregate() call; pagination is done inside it with $facet.
// Index used: users { interests: 1 } (multikey), via the leading $match.
// ===========================================================================

export interface InterestGroup {
  interest: string;
  count: number;
  users: { _id: Types.ObjectId; name: string }[];
}

export function interestGroupsPipeline(p: Pagination, interest?: string): PipelineStage[] {
  // { $type: 'string' } on an array field matches docs with at least one string element,
  // so users with no interests are skipped by an index range scan on { interests: 1 },
  // not a collection scan. When a specific interest is requested, the equality match
  // uses the same index.
  const match = interest ? { interests: interest } : { interests: { $type: 'string' } };
  return [
    { $match: match },
    { $project: { _id: 1, name: 1, interests: 1 } },
    { $unwind: '$interests' },
    ...(interest ? [{ $match: { interests: interest } }] : []),
    {
      $group: {
        _id: '$interests',
        count: { $sum: 1 },
        users: { $push: { _id: '$_id', name: '$name' } },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    {
      $facet: {
        data: [
          { $skip: p.skip },
          { $limit: p.limit },
          { $project: { _id: 0, interest: '$_id', count: 1, users: 1 } },
        ],
        total: [{ $count: 'value' }],
      },
    },
  ] as PipelineStage[];
}

export async function getUsersGroupedByInterest(p: Pagination, interest?: string) {
  const [result] = await UserModel.aggregate<{ data: InterestGroup[]; total: { value: number }[] }>(
    interestGroupsPipeline(p, interest),
  );
  const total = result?.total[0]?.value ?? 0;
  return { data: result?.data ?? [], total };
}

// ===========================================================================
// Scenario 2: all posts belonging to one user
// A single pipeline with a $lookup stage.
//   $match { _id }        -> default _id index on users
//   $lookup posts.author  -> posts { author: 1, _id: -1 } (equality + sort, then skip/limit)
// ===========================================================================

export function userPostsPipeline(userId: Types.ObjectId, p: Pagination): PipelineStage[] {
  return [
    { $match: { _id: userId } },
    {
      $lookup: {
        from: PostModel.collection.collectionName,
        localField: '_id',
        foreignField: 'author',
        pipeline: [
          { $sort: { _id: -1 } },
          { $skip: p.skip },
          { $limit: p.limit + 1 }, // one extra row tells us whether another page exists
          { $project: { __v: 0 } },
        ],
        as: 'posts',
      },
    },
    // Public endpoint: expose only the author's name, never email/role/passwordHash.
    { $project: { _id: 1, name: 1, posts: 1 } },
  ] as PipelineStage[];
}

export async function getUserPosts(userId: Types.ObjectId, p: Pagination) {
  const [doc] = await UserModel.aggregate<{
    _id: Types.ObjectId;
    name: string;
    posts: Record<string, unknown>[];
  }>(userPostsPipeline(userId, p));
  if (!doc) return null;

  const hasMore = doc.posts.length > p.limit;
  return {
    author: { _id: doc._id, name: doc.name },
    data: doc.posts.slice(0, p.limit),
    page: p.page,
    limit: p.limit,
    hasMore,
  };
}
