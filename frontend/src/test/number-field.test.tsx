import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MAX_COUNT, NumberField, isAcceptable } from '../components/NumberField';

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <NumberField id="n" label="मत" value={v} onChange={setV} />
      <output data-testid="value">{JSON.stringify(v)}</output>
    </>
  );
}
const value = () => screen.getByTestId('value').textContent;

describe('NumberField', () => {
  it('accepts digits only: no minus, dot, comma, "e", plus or spaces', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('मत');
    await userEvent.type(input, '-1.5e+3, 2');
    expect(value()).toBe('"1532"');
  });

  it('typing "12a3" keeps only the digits', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('मत'), '12a3');
    expect(value()).toBe('"123"');
  });

  it('empty stays empty — it is NOT zero; 0 must be typed', async () => {
    render(<Harness />);
    expect(value()).toBe('""');
    await userEvent.type(screen.getByLabelText('मत'), '0');
    expect(value()).toBe('"0"');
    await userEvent.clear(screen.getByLabelText('मत'));
    expect(value()).toBe('""');
  });

  it('the mouse wheel never changes the value', () => {
    render(<Harness initial="25" />);
    const input = screen.getByLabelText('मत');
    input.focus();
    fireEvent.wheel(input, { deltaY: -100 });
    fireEvent.wheel(input, { deltaY: 100 });
    expect(value()).toBe('"25"');
    expect(document.activeElement).not.toBe(input); // wheel takes the focus away
  });

  it('pasting text with a sign, decimal or exponent is refused as a whole', () => {
    render(<Harness initial="7" />);
    const input = screen.getByLabelText('मत');
    for (const bad of ['-5', '2.5', '1e3', '1 000', '१२']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(value(), bad).toBe('"7"');
    }
    fireEvent.change(input, { target: { value: '0042' } });
    expect(value()).toBe('"0042"');
  });

  it('never more than 10 digits or above the largest storable count', () => {
    expect(isAcceptable(String(MAX_COUNT))).toBe(true);
    expect(isAcceptable(String(MAX_COUNT + 1))).toBe(false);
    expect(isAcceptable('12345678901')).toBe(false);
    expect(isAcceptable('')).toBe(true);
  });

  it('uses a text input with a numeric keypad (not type=number, which allows "e" and the wheel)', () => {
    render(<Harness />);
    const input = screen.getByLabelText('मत');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });
});
