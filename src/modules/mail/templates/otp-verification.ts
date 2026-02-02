// otp-verification.ts
import { baseTemplate } from './base';

export function verificationOtpTemplate(otp: string, minutes: number) {
  return baseTemplate(
    'Verify your account',
    `
    <p>Welcome 👋</p>
    <p>Use the OTP below to verify your account:</p>
    <div class="otp">${otp}</div>
    <p>This code expires in <strong>${minutes} minutes</strong>.</p>
    <p>If you didn’t request this, please ignore this email.</p>
    `,
  );
}
