import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user', required: true },
    interests: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

// ---------------------------------------------------------------------------
// Indexes. Only these are declared; every other User read goes through _id.
// ---------------------------------------------------------------------------

// Login & registration look users up by email; also enforces uniqueness.
userSchema.index({ email: 1 }, { unique: true });

// Aggregation "users grouped by interests": the pipeline's first stage is
// { $match: { interests: { $type: 'string' } } }, which is bounded by this multikey index.
userSchema.index({ interests: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
