// 密码哈希工具（bcrypt）
// 方案 §1.2：bcrypt cost 10，密码 ≥8 字符

import bcrypt from 'bcrypt';

const COST = 10;
const MIN_LENGTH = 8;

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string' || plaintext.length < MIN_LENGTH) {
    throw new Error(`password must be at least ${MIN_LENGTH} characters`);
  }
  return bcrypt.hash(plaintext, COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (typeof plaintext !== 'string' || typeof hash !== 'string') return false;
  return bcrypt.compare(plaintext, hash);
}

export const PASSWORD_MIN_LENGTH = MIN_LENGTH;
