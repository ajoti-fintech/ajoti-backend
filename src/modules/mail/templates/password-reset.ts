import { baseTemplate } from './base';

export function passwordResetTemplate(fullName: string) {
  const body = `
  <h2 class="greeting">Password Reset Successful</h2>
  
  <p class="message">
   Hi ${fullName}, you have successfully reset your password. You can now log in with your new password.
  </p>

  <p class="message">
    If you did not request this change, please contact our support team immediately. We're here to help!
  </p>
`;
  return baseTemplate(body);
}
