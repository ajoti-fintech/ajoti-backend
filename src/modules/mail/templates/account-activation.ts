import { baseTemplate } from './base';

export function accountActivationTemplate(fullName: string) {
  const body = `
  <h2 class="greeting">Your account is now activated, ${fullName}! ✅</h2>
  
  <p class="message">
   Your email has been verified. You can now log in and start using Ajoti.
  </p>

  <p class="message">
    If you have any questions or need assistance getting started, our support team is here to help. Just reply to this email or visit our help center.
    <br><br>
    Best regards,<br>
    The Ajoti Team
  </p>
`;
  return baseTemplate(body);
}
