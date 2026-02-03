import { baseTemplate } from './base';

export function resetPasswordOtpTemplate(otp: string, minutes: number, fullName?: string) {
  // const title = `Password Reset Request`;
  const body = `
  <p class="greeting">Hello ${fullName || ''},</p>
  
  <p class="message">
    We received a request to reset your password for your Ajoti account. 
    To proceed with the password reset, please use the One-Time Password (OTP) below.
  </p>
  
  <div class="otp-container">
    <div class="otp-label">Your Password Reset Code</div>
    <div class="otp-code">${otp}</div>
    <div class="otp-expiry">
      This code will expire in <strong>${minutes} minutes</strong>.
    </div>
  </div>
  
  <div class="btn-container">
    <a href="https://app.ajoti.com/reset-password" class="verify-btn">Reset Password Now</a>
  </div>
  
  <div class="instructions">
    <h3>Important Information:</h3>
    <ul>
      <li>Enter this code on the password reset page to create a new password</li>
      <li>Do not share this code with anyone - Ajoti will never ask for your OTP</li>
      <li>If you didn't request a password reset, please ignore this email and ensure your account is secure</li>
      <li>For security, this code can only be used once</li>
    </ul>
  </div>
  
  <p class="message">
    If you have any questions or need assistance, please contact our support team at 
    <a href="mailto:support@ajoti.com" style="color: #10B981; text-decoration: none;">support@ajoti.com</a>.
    <br><br>
    Stay secure,<br>
    The Ajoti Team
  </p>
`;
  return baseTemplate(body);
}
