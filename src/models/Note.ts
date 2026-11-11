import { Schema, model, type InferSchemaType } from 'mongoose';

const noteSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20_000 },
  },
  { timestamps: true, versionKey: false },
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// "List my notes" (and admin "notes of user X"):
//   find({ owner }).sort({ _id: -1 }).skip().limit()  +  countDocuments({ owner })
// Equality on owner then sort on _id -> index-only bounds, no in-memory sort.
// Also serves deleteMany({ owner }) when an admin removes a user.
// (Single-note reads/updates/deletes use the default _id index.)
noteSchema.index({ owner: 1, _id: -1 });

export type Note = InferSchemaType<typeof noteSchema>;
export const NoteModel = model('Note', noteSchema);
