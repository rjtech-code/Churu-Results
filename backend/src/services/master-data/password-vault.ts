// The ONE documented exception to "passwords only as bcrypt" (CLAUDE.md): the DM may view an RO's
// current password, so an AES-256-GCM encrypted copy is kept for PS_RO / ZP_RO accounts only (never
// for the DM). Login uses the bcrypt hash alone. Key: env RO_PASSWORD_KEY (32 bytes, base64).
// Stored value = version(1) | iv(12) | auth tag(16) | ciphertext. A fresh random IV every time.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
export const KEY_LENGTH = 32;

/** The key from its base64 text, or null when it is not valid base64 of exactly 32 bytes. */
export function parseVaultKey(text: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) return null;
  const key = Buffer.from(text, 'base64');
  return key.length === KEY_LENGTH ? key : null;
}

export function encryptPassword(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/** Throws when the value was changed or the key is wrong (GCM authentication fails). */
export function decryptPassword(blob: Buffer, key: Buffer): string {
  if (blob.length < 1 + IV_LENGTH + TAG_LENGTH || blob[0] !== VERSION) {
    throw new Error('unreadable password copy');
  }
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const body = blob.subarray(1 + IV_LENGTH + TAG_LENGTH);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
