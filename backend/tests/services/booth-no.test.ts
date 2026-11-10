// Booth numbers with an "A" suffix (e.g. 15A): parse, label, sort.
import { describe, expect, it } from 'vitest';
import {
  boothLabel,
  boothLabelOf,
  compareBoothNo,
  parseBoothNo,
} from '../../src/services/booth-no.js';
import { compactNumbers } from '../../src/services/counting-status.js';

describe('booth numbers', () => {
  it('parses whole numbers and one-letter suffixes', () => {
    expect(parseBoothNo(12)).toEqual({ no: 12, suffix: '' });
    expect(parseBoothNo('12')).toEqual({ no: 12, suffix: '' });
    expect(parseBoothNo('12A')).toEqual({ no: 12, suffix: 'A' });
    expect(parseBoothNo(' 111A ')).toEqual({ no: 111, suffix: 'A' });
  });

  it.each([0, -1, 1.5, '0', '012', '12a', 'A12', '12 A', '12-A', '12ABC', '', '65536', null, true])(
    'rejects %j',
    (value) => {
      expect(parseBoothNo(value)).toBeNull();
    },
  );

  it('labels: 12 + "" -> "12", 12 + "A" -> "12A"', () => {
    expect(boothLabel(12, '')).toBe('12');
    expect(boothLabel(12, 'A')).toBe('12A');
    expect(boothLabelOf({ booth_no: 15, booth_suffix: 'A' })).toBe('15A');
  });

  it('a query that forgot booth_suffix fails loudly instead of showing "12"', () => {
    expect(() => boothLabelOf({ booth_no: 12 })).toThrow(/booth_suffix/);
  });

  it('sorts 12 before 12A before 13 (and numerically, not as text)', () => {
    const labels = ['13', '12A', '2', '12', '111A', '1', '111'];
    expect([...labels].sort(compareBoothNo)).toEqual(['1', '2', '12', '12A', '13', '111', '111A']);
  });

  it('pending-booth ranges never swallow an "A" booth', () => {
    expect(compactNumbers(['12', '12A', '13', '14', 3])).toBe('3, 12, 12A, 13–14');
    expect(compactNumbers(['11', '12', '13', '15A'])).toBe('11–13, 15A');
    expect(compactNumbers(['12A', '12A'])).toBe('12A');
  });
});
