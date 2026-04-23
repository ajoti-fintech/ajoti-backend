import { baseTemplate } from './base';

export function adminReminderTemplate(fullName: string, circleName: string, message: string) {
  const body = `
    <h2 class="greeting">Message from your circle admin</h2>
    <p class="message">Hi ${fullName},</p>
    <p class="message">
      Your admin for <strong>${circleName}</strong> has sent you the following message:
    </p>
    <div class="instructions">
      <p style="font-size: 15px; color: #374151; line-height: 1.6;">${message}</p>
    </div>
    <p class="message">Log in to your Ajoti account to take any required action.</p>
  `;
  return baseTemplate(body);
}
