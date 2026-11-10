// Screen access keys: pure logic (no DB). Every screen key goes through these functions only.
//
// A key is 12 characters from an alphabet without look-alikes (no I, O, 0, 1), shown and typed as
// XXXX-XXXX-XXXX (easy on a TV remote or a phone). 32^12 = 2^60 possible keys, chosen with
// crypto.randomInt (uniform). Typing is forgiving: case, spaces and hyphens are ignored.
//
// The DB keeps an HMAC-SHA256 of the normalized key (secret derived from RO_PASSWORD_KEY), so a
// copy of the database alone does not allow guessing keys offline. Screen session tokens are 32
// random bytes; only their SHA-256 is stored.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const SCREEN_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SCREEN_KEY_LENGTH = 12;
const GROUP = 4;

/** A new random key, grouped: "K7QF-M3XA-9PZR". */
export function generateScreenKey(): string {
  let raw = '';
  for (let i = 0; i < SCREEN_KEY_LENGTH; i++) {
    raw += SCREEN_KEY_ALPHABET.charAt(randomInt(SCREEN_KEY_ALPHABET.length));
  }
  return formatScreenKey(raw);
}

/** "K7QFM3XA9PZR" -> "K7QF-M3XA-9PZR". */
export function formatScreenKey(raw: string): string {
  return (raw.match(new RegExp(`.{1,${String(GROUP)}}`, 'g')) ?? []).join('-');
}

const VALID = new RegExp(`^[${SCREEN_KEY_ALPHABET}]{${String(SCREEN_KEY_LENGTH)}}$`);

/**
 * The key as typed -> its 12 canonical characters, or null when it cannot be a key (wrong length or
 * a character outside the alphabet). Spaces and hyphens are ignored; lower case is accepted.
 */
export function normalizeScreenKey(input: string): string | null {
  const raw = input.replace(/[\s-]/g, '').toUpperCase();
  return VALID.test(raw) ? raw : null;
}

/** The HMAC secret for key hashes, derived from the vault key (never the vault key itself). */
export function screenKeyHashSecret(vaultKey: Buffer): Buffer {
  return createHmac('sha256', vaultKey).update('churu-screen-key-hash-v1').digest();
}

/** HMAC-SHA256 of the canonical key (32 bytes). */
export function hashScreenKey(canonical: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(canonical, 'utf8').digest();
}

/** Constant-time equality of two hashes (false for different lengths). */
export function hashesEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A new screen session token for the cookie (base64url of 32 random bytes = 43 characters). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 of a well-formed session token, or null for anything else (no DB lookup for junk). */
export function hashSessionToken(token: string): Buffer | null {
  return TOKEN.test(token) ? createHash('sha256').update(token, 'utf8').digest() : null;
}

/** One cookie's value from a raw Cookie header (no extra dependency for one cookie). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
