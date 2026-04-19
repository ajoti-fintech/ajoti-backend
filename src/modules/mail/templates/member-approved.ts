import { baseTemplate } from './base';

export function memberApprovedTemplate(fullName: string, circleName: string, payoutPosition: number) {
  const body = `
    <h2 class="greeting">You've been accepted! 🎉</h2>
    <p class="message">
      Hi ${fullName}, congratulations! Your request to join
      <strong>${circleName}</strong> has been approved by the circle admin.
    </p>
    <div class="otp-container">
      <div class="otp-label">Your Payout Position</div>
      <div class="otp-code">#${payoutPosition}</div>
      <p class="otp-expiry">
        This is your current slot. Positions may be updated by the admin before the circle starts.
      </p>
    </div>
    <div class="instructions">
      <h3>What happens next?</h3>
      <ul>
        <li>The admin will activate the circle once all slots are filled.</li>
        <li>You will receive a notification when the circle officially starts.</li>
        <li>Make sure your wallet is topped up before the first contribution deadline.</li>
      </ul>
    </div>
    <p class="message">
      Log in to your Ajoti account to view the circle details and your fellow members.
    </p>
  `;
  return baseTemplate(body);
}
