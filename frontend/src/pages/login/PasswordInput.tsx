import { EyeIcon, EyeOffIcon } from './icons';
import { LOGIN_TEXTS as T } from './loginTexts';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  shown: boolean;
  onToggle: () => void;
}

// Password input with a show/hide eye button. The parent owns `shown` so it can hide it again on submit.
export function PasswordInput({ id, value, onChange, shown, onToggle }: Props) {
  return (
    <div className="password-field">
      <input
        id={id}
        className="login-input"
        type={shown ? 'text' : 'password'}
        autoComplete="current-password"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={shown ? T.hidePassword : T.showPassword}
        aria-pressed={shown}
        aria-controls={id}
        onClick={onToggle}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
