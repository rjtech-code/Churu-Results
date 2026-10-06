import { resolve } from 'node:path';

/** Repository root (scripts/lib -> backend -> repo). */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const BACKEND_ROOT = resolve(REPO_ROOT, 'backend');
export const DEFAULT_REPORTS_DIR = resolve(BACKEND_ROOT, 'reports');
export const TEMPLATES_DIR = resolve(REPO_ROOT, 'docs', 'templates');

/**
 * Resolves a path given on the command line. `npm run` changes cwd to backend/, but INIT_CWD keeps
 * the directory the user typed the command in, so relative paths mean what the user expects.
 */
export function resolveUserPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}
