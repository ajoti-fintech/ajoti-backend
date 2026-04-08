import { baseTemplate } from './base';

export function passwordChangedTemplate(fullName: string) {
  const body = `
  <h2 class="greeting">Password Changed Successfully</h2>
  
  <p class="message">
   Hi ${fullName}, you have successfully changed your password. You can now log in with your new password.
  </p>

  <p class="message">
    If you did not make this change, please contact our support team immediately. We're here to help!
  </p>
`;
  return baseTemplate(body);
}
