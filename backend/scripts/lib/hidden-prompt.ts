// A hidden terminal prompt for secrets: nothing is echoed, so the password never appears on the
// screen, in the scrollback or in shell history (it is typed, never a CLI argument).
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { ScriptError } from './db.js';

/** Asks on the terminal with echo off. Refuses when stdin is not an interactive terminal. */
export async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new ScriptError(
      'The password must be typed at an interactive terminal (stdin is not a TTY).',
    );
  }
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  process.stdout.write(label);
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    const answer = await rl.question('');
    process.stdout.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}
