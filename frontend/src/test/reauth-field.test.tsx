import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api';
import { messageFor } from '../api/errors';
import { reauthTexts } from '../components/ReauthPasswordField';

describe('the password confirmation texts follow the role', () => {
  it('DM sees the Admin texts; PS_RO and ZP_RO see the RO texts', () => {
    expect(reauthTexts('DM')).toEqual({
      label: 'Admin Password (सत्यापन हेतु)',
      placeholder: 'Enter Admin Password',
    });
    for (const role of ['PS_RO', 'ZP_RO'])
      expect(reauthTexts(role)).toEqual({
        label: 'RO Password (सत्यापन हेतु)',
        placeholder: 'Enter your RO Password',
      });
  });

  it('a wrong password has one message everywhere', () => {
    expect(messageFor(new ApiError(401, 'REAUTH_FAILED', {}))).toBe(
      'Incorrect password. कृपया पुनः प्रयास करें।',
    );
  });
});
