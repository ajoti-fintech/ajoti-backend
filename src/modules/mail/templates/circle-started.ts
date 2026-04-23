import { baseTemplate } from './base';

export function circleStartedTemplate(
  fullName: string,
  circleName: string,
  firstDeadline: string,
  contributionAmount: string,
  payoutPosition: number,
) {
  const body = `
    <h2 class="greeting">Your circle has started!</h2>
    <p class="message">
      Hi ${fullName}, great news — <strong>${circleName}</strong> is now officially active.
      The savings cycle has begun and your first contribution is due soon.
    </p>
    <div class="otp-container">
      <div class="otp-label">First Contribution Deadline</div>
      <div class="otp-code" style="font-size: 22px;">${firstDeadline}</div>
      <p class="otp-expiry">
        Amount due: <strong>₦${contributionAmount}</strong> &nbsp;|&nbsp; Your payout position: <strong>#${payoutPosition}</strong>
      </p>
    </div>
    <div class="instructions">
      <h3>Important reminders</h3>
      <ul>
        <li>Ensure your Ajoti wallet has at least <strong>₦${contributionAmount}</strong> available before the deadline.</li>
        <li>Contributions made after the deadline attract a late penalty.</li>
        <li>Missing a contribution entirely may affect your trust score and collateral.</li>
      </ul>
    </div>
    <p class="message">
      Log in to your Ajoti account to view the full payment schedule and your circle details.
    </p>
  `;
  return baseTemplate(body);
}
