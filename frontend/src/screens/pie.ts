// Pie slice math for the seats-won chart (plain SVG, no chart library).

export interface PieInput {
  key: string;
  label: string;
  value: number;
  colour: string;
}

export interface Slice extends PieInput {
  startAngle: number;
  endAngle: number;
  /** One party has every seat: draw a full circle (an SVG arc cannot draw 360°). */
  full: boolean;
  /** SVG path; empty when `full`. */
  path: string;
}

/** Point on the circle; 0° at the top, clockwise. */
function point(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

const n = (x: number) => Number(x.toFixed(3));

/** Slices for the positive values, in input order. Angles sum to exactly 360. No values: []. */
export function pieSlices(rows: readonly PieInput[], cx: number, cy: number, r: number): Slice[] {
  const parts = rows.filter((row) => row.value > 0);
  const total = parts.reduce((s, row) => s + row.value, 0);
  if (total === 0) return [];
  let start = 0;
  return parts.map((row, i) => {
    const end = i === parts.length - 1 ? 360 : start + (row.value / total) * 360;
    const full = parts.length === 1;
    const [x1, y1] = point(cx, cy, r, start);
    const [x2, y2] = point(cx, cy, r, end);
    const large = end - start > 180 ? 1 : 0;
    const path = full
      ? ''
      : `M ${n(cx)} ${n(cy)} L ${n(x1)} ${n(y1)} A ${r} ${r} 0 ${large} 1 ${n(x2)} ${n(y2)} Z`;
    const slice = { ...row, startAngle: start, endAngle: end, full, path };
    start = end;
    return slice;
  });
}
