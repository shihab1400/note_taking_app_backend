import bcrypt from 'bcryptjs';

const COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// When a login email doesn't exist we still run one bcrypt compare against this hash,
// so response timing doesn't reveal which emails are registered. Computed lazily to keep cold starts fast.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash('timing-equalizer-not-a-real-password', COST);
  await bcrypt.compare(plain, await dummyHash);
}
