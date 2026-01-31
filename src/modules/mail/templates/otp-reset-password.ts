// otp-reset-password.ts
import { baseTemplate } from './base';

export function resetPasswordOtpTemplate(otp: string, minutes: number) {
  return baseTemplate(
    'Reset your password',
    `
    <p>You requested to reset your password.</p>
    <p>Use the OTP below:</p>
    <div class="otp">${otp}</div>
    <p>This code expires in <strong>${minutes} minutes</strong>.</p>
    <p>If this wasn’t you, secure your account immediately.</p>
    `,
  );
}
