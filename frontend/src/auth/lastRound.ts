// The last round number this operator used (in memory only, per browser tab; default 1).
let lastRound = 1;

export function getLastRound(): number {
  return lastRound;
}

export function setLastRound(round: number): void {
  lastRound = round;
}
