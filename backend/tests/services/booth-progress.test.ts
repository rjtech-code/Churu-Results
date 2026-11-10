import { describe, expect, it } from 'vitest';
import { boothProgress, boothProgressByPs } from '../../src/services/booth-progress.js';

describe('boothProgress (booths entered / total booths)', () => {
  it('counts every booth of the list once; entered = has a live entry', () => {
    const booths = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(boothProgress(booths, new Set())).toEqual({ entered: 0, total: 4 });
    expect(boothProgress(booths, new Set([2, 4]))).toEqual({ entered: 2, total: 4 });
    expect(boothProgress(booths, new Set([1, 2, 3, 4]))).toEqual({ entered: 4, total: 4 });
    expect(boothProgress([], new Set([1]))).toEqual({ entered: 0, total: 0 });
  });

  it('an entry of a booth outside the list is never counted', () => {
    expect(boothProgress([{ id: 1 }, { id: 2 }], new Set([2, 99]))).toEqual({
      entered: 1,
      total: 2,
    });
  });

  it('by PS (a ZP ward across several PS): the parts add up to the whole ward', () => {
    const booths = [
      { id: 1, psId: 10 },
      { id: 2, psId: 10 },
      { id: 3, psId: 20 },
      { id: 4, psId: 10 },
      { id: 5, psId: 30 },
    ];
    const entered = new Set([1, 3, 4]);
    const byPs = boothProgressByPs(booths, entered);
    expect([...byPs]).toEqual([
      [10, { entered: 2, total: 3 }],
      [20, { entered: 1, total: 1 }],
      [30, { entered: 0, total: 1 }],
    ]);
    const parts = [...byPs.values()];
    expect({
      entered: parts.reduce((s, p) => s + p.entered, 0),
      total: parts.reduce((s, p) => s + p.total, 0),
    }).toEqual(boothProgress(booths, entered));
  });
});
