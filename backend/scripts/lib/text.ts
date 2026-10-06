/** Unicode NFC + trimmed + inner whitespace collapsed, so the same name typed twice is identical. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Case-insensitive key for matching names such as Panchayat Samiti or party short names. */
export function matchKey(value: string): string {
  return normalizeText(value).toLocaleUpperCase('en-US');
}
