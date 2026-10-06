export const REASON_MIN = 10;
export const REASON_MAX = 500;

export function reasonProblem(reason: string): string | null {
  const len = reason.trim().length;
  if (len < REASON_MIN) return `कारण कम से कम ${REASON_MIN} अक्षर का लिखें`;
  if (len > REASON_MAX) return `कारण ${REASON_MAX} अक्षर से अधिक नहीं`;
  return null;
}

export function ReasonField({
  id,
  value,
  onChange,
  label = 'कारण (अनिवार्य)',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={3}
        maxLength={REASON_MAX}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      <small>
        {value.trim().length}/{REASON_MAX}
      </small>
    </div>
  );
}
