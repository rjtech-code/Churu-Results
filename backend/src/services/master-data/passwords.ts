import { randomInt } from 'node:crypto';
import bcrypt from 'bcrypt';

// No look-alike characters: no 0/O/o, no 1/l/I.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const ALPHABET = UPPER + LOWER + DIGITS;

export const PASSWORD_LENGTH = 16;
export const BCRYPT_COST = 12;

function hasAny(password: string, chars: string): boolean {
  // ASCII only, so splitting into characters is safe.
  return password.split('').some((c) => chars.includes(c));
}

/** Cryptographically random password with at least one upper, one lower and one digit. */
export function generatePassword(length = PASSWORD_LENGTH): string {
  for (;;) {
    let password = '';
    for (let i = 0; i < length; i++) password += ALPHABET.charAt(randomInt(ALPHABET.length));
    if (hasAny(password, UPPER) && hasAny(password, LOWER) && hasAny(password, DIGITS)) {
      return password;
    }
  }
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}
