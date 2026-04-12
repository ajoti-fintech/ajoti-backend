import { baseTemplate } from './base';

export function topUpReminderTemplate(
  fullName: string,
  circleName: string,
  requiredNaira: string,
  availableNaira: string,
) {
  const body = `
    <h2 class="greeting">Top up your wallet</h2>
    <p class="message">
      Hi ${fullName}, your available wallet balance may not be enough to cover
      your upcoming contribution to <strong>${circleName}</strong>.
    </p>
    <div class="otp-container">
      <div class="otp-label">Required</div>
      <div class="otp-code">₦${requiredNaira}</div>
      <p class="otp-expiry">
        Your current available balance: <strong>₦${availableNaira}</strong>
      </p>
    </div>
    <div class="instructions">
      <h3>How to top up</h3>
      <ul>
        <li>Log in to your Ajoti account and navigate to your wallet.</li>
        <li>Fund your wallet via bank transfer or card before the contribution deadline.</li>
        <li>Ensure your available balance is at least <strong>₦${requiredNaira}</strong>.</li>
      </ul>
    </div>
    <p class="message">
      Please top up as soon as possible to avoid a late contribution penalty.
    </p>
  `;
  return baseTemplate(body);
}
