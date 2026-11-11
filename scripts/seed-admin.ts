// Usage: npm run seed-admin
// Creates (or promotes) the first admin from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD.
import { z } from 'zod';
import { connectDB, disconnectDB } from '../src/db/connect.js';
import { UserModel } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';
import { email, name, password } from '../src/utils/validation.js';

const input = z
  .object({ ADMIN_NAME: name.default('Admin'), ADMIN_EMAIL: email, ADMIN_PASSWORD: password })
  .parse(process.env);

await connectDB();

const existing = await UserModel.findOne({ email: input.ADMIN_EMAIL });
if (existing) {
  existing.role = 'admin';
  await existing.save();
  console.log(`Promoted existing user ${input.ADMIN_EMAIL} to admin (password unchanged).`);
} else {
  await UserModel.create({
    name: input.ADMIN_NAME,
    email: input.ADMIN_EMAIL,
    role: 'admin',
    passwordHash: await hashPassword(input.ADMIN_PASSWORD),
  });
  console.log(`Created admin ${input.ADMIN_EMAIL}.`);
}

await disconnectDB();
