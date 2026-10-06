import { EventEmitter } from 'node:events';

/** In-process events. Part 7 (SSE) listens; nothing here talks to clients. */
export interface AppEvents {
  /** A ward's counting data changed. Emitted ONLY after a successful commit. */
  'ward-changed': [{ wardId: number }];
}

export const appEvents = new EventEmitter<AppEvents>();

export function emitWardChanged(wardId: number): void {
  appEvents.emit('ward-changed', { wardId });
}
