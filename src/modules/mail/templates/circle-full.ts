import { baseTemplate } from './base';

export function circleFullMemberTemplate(
  fullName: string,
  circleName: string,
  totalSlots: number,
) {
  const body = `
    <h2 class="greeting">Your circle is full!</h2>
    <p class="message">
      Hi ${fullName}, <strong>${circleName}</strong> now has all ${totalSlots} members confirmed.
      The circle admin will set a start date soon — you'll receive another notification when the cycle begins.
    </p>
    <div class="otp-container">
      <div class="otp-label">Circle</div>
      <div class="otp-code" style="font-size: 22px;">${circleName}</div>
      <p class="otp-expiry">All <strong>${totalSlots}</strong> slots are now filled. Get ready to save!</p>
    </div>
    <p class="message">
      Log in to your Ajoti account to view circle details and your payout position.
    </p>
  `;
  return baseTemplate(body);
}

export function circleFullAdminTemplate(
  adminName: string,
  circleName: string,
  totalSlots: number,
) {
  const body = `
    <h2 class="greeting">All slots filled — ready to activate!</h2>
    <p class="message">
      Hi ${adminName}, <strong>${circleName}</strong> now has all ${totalSlots} members approved and confirmed.
      You can now activate the circle and set the first contribution deadline.
    </p>
    <div class="otp-container">
      <div class="otp-label">Next step</div>
      <div class="otp-code" style="font-size: 18px;">Activate ${circleName}</div>
      <p class="otp-expiry">Log in to your admin dashboard and click <strong>Start Circle</strong> to begin the savings cycle.</p>
    </div>
  `;
  return baseTemplate(body);
}
