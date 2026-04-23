import { baseTemplate } from './base';

export function emailChangeOtpTemplate(otp: string, minutes: number, fullName?: string) {
  const body = `
  <p class="greeting">Hello ${fullName || ''},</p>
  
  <p class="message">
    We received a request to change the email address on your Ajoti account.
    Please use the One-Time Password (OTP) below to confirm your new email address.
  </p>
  
  <div class="otp-container">
    <div class="otp-label">Your Email Change Code</div>
    <div class="otp-code">${otp}</div>
    <div class="otp-expiry">
      This code will expire in <strong>${minutes} minutes</strong>.
    </div>
  </div>
  
  <div class="btn-container">
    <a href="https://app.ajoti.com/profile" class="verify-btn">Confirm Email Change</a>
  </div>
  
  <div class="instructions">
    <h3>Important Information:</h3>
    <ul>
      <li>Enter this code on the email verification screen to complete the change</li>
      <li>Your current login email stays active until this code is verified</li>
      <li>If you did not request this change, ignore this email and keep your account secure</li>
      <li>Ajoti will never ask you to share this OTP with anyone</li>
    </ul>
  </div>
  
  <p class="message">
    Need help? Contact our support team at
    <a href="mailto:support@ajoti.com" style="color: #10B981; text-decoration: none;">support@ajoti.com</a>.
    <br><br>
    Stay secure,<br>
    The Ajoti Team
  </p>
`;

  return baseTemplate(body);
}
