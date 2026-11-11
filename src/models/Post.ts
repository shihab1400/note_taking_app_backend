import { Schema, model, type InferSchemaType } from 'mongoose';

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 20_000 },
  },
  { timestamps: true, versionKey: false },
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Aggregation "posts of a user": the $lookup joins users._id -> posts.author and
// its sub-pipeline sorts by _id desc. Equality on author + sort on _id is fully
// served by this index. Also serves deleteMany({ author }) on user removal.
postSchema.index({ author: 1, _id: -1 });

export type Post = InferSchemaType<typeof postSchema>;
export const PostModel = model('Post', postSchema);
