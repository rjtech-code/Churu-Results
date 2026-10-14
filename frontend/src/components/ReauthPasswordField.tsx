import { useRole } from '../auth/AuthContext';

/** The confirmation field where the user types their OWN password again; the words follow the role. */
export function reauthTexts(role: string | null): { label: string; placeholder: string } {
  return role === 'PS_RO' || role === 'ZP_RO'
    ? { label: 'RO Password (सत्यापन हेतु)', placeholder: 'Enter your RO Password' }
    : { label: 'Admin Password (सत्यापन हेतु)', placeholder: 'Enter Admin Password' };
}

export function ReauthPasswordField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { label, placeholder } = reauthTexts(useRole());
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        autoComplete="current-password"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </>
  );
}
