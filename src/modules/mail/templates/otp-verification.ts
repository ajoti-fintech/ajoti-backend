import { baseTemplate } from './base';

export function verificationOtpTemplate(otp: string, minutes: number, fullName?: string) {
  // const title = `Verify Your Email Address`;
  const body = `
  <p class="greeting">Welcome ${fullName || ''}!</p>
  
  <p class="message">
    Thank you for creating an account with Ajoti! To complete your registration and 
    start using all our features, please verify your email address using the One-Time 
    Password (OTP) below.
  </p>
  
  <div class="otp-container">
    <div class="otp-label">Your Email Verification Code</div>
    <div class="otp-code">${otp}</div>
    <div class="otp-expiry">
      This code will expire in <strong>${minutes} minutes</strong>.
    </div>
  </div>
  
  <div class="btn-container">
    <a href="https://app.ajoti.com/verify-email" class="verify-btn">Verify Email Now</a>
  </div>
  
  <div class="instructions">
    <h3>What's Next?</h3>
    <ul>
      <li>Enter this code on the verification page to activate your account</li>
      <li>Keep this code secure and don't share it with anyone</li>
      <li>If you didn't create an account with Ajoti, please ignore this email</li>
      <li>Verifying your email ensures you receive important account notifications</li>
    </ul>
  </div>
  
  <p class="message">
    Once verified, you'll have full access to your Ajoti account. 
    We're excited to have you join our community!
    <br><br>
    Best regards,<br>
    The Ajoti Team
  </p>
`;
  return baseTemplate(body);
}
