import type { KeyboardEvent, Ref } from 'react';

/** INT UNSIGNED, the largest number the database stores. */
export const MAX_COUNT = 4_294_967_295;
const MAX_DIGITS = 10;

/** True for "" or a run of digits within range (no sign, dot, exponent or spaces). */
export function isAcceptable(value: string): boolean {
  if (value === '') return true;
  return /^\d+$/.test(value) && value.length <= MAX_DIGITS && Number(value) <= MAX_COUNT;
}

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter key: move on (the form decides where). */
  onEnter?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  autoFocus?: boolean;
}

/**
 * A count field: digits only, never negative/decimal/exponent, mouse wheel never changes it,
 * and empty stays empty (an empty field is NOT zero — 0 must be typed).
 */
export function NumberField({ id, label, value, onChange, onEnter, inputRef, className, autoFocus }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
    }
  };
  return (
    <input
      id={id}
      ref={inputRef}
      aria-label={label}
      className={`num ${className ?? ''}`}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        if (isAcceptable(next)) onChange(next); // anything else is simply not taken
      }}
      onKeyDown={onKeyDown}
      onWheel={(e) => {
        e.currentTarget.blur(); // a wheel never changes a count
      }}
    />
  );
}
