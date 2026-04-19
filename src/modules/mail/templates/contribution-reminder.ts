import { baseTemplate } from './base';

export function contributionReminderTemplate(
  fullName: string,
  circleName: string,
  cycleNumber: number,
  contributionAmount: string,
  deadline: string,
) {
  const body = `
    <h2 class="greeting">Contribution Reminder</h2>
    <p class="message">
      Hi ${fullName}, you have not yet made your contribution for <strong>cycle ${cycleNumber}</strong>
      in the circle <strong>${circleName}</strong>.
    </p>
    <div class="otp-container">
      <div class="otp-label">Amount Due</div>
      <div class="otp-code">₦${contributionAmount}</div>
      <p class="otp-expiry">
        Deadline: <strong>${deadline}</strong>
      </p>
    </div>
    <div class="instructions">
      <h3>Why this matters</h3>
      <ul>
        <li>Contributing on time keeps your trust score high.</li>
        <li>Late contributions attract a penalty charge.</li>
        <li>Missing a contribution entirely may result in collateral seizure.</li>
      </ul>
    </div>
    <p class="message">
      Please log in to your Ajoti account and make your contribution before the deadline.
    </p>
  `;
  return baseTemplate(body);
}
