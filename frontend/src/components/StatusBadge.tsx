import type { WardStatus } from '../api/types';
import { STATUS_HINDI } from './format';

/** Colour is always paired with text. */
export function StatusBadge({ status }: { status: WardStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase().replaceAll('_', '-')}`}>{STATUS_HINDI[status]}</span>
  );
}
