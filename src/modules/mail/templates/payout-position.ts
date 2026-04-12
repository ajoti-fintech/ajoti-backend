import { baseTemplate } from './base';

export function payoutPositionTemplate(
  fullName: string,
  circleName: string,
  position: number,
  isReassignment: boolean,
) {
  const action = isReassignment ? 'updated' : 'assigned';
  const body = `
    <h2 class="greeting">${isReassignment ? 'Payout Position Updated' : 'Payout Position Assigned'}</h2>
    <p class="message">
      Hi ${fullName}, your payout position in the circle <strong>${circleName}</strong> has been ${action}.
    </p>
    <div class="otp-container">
      <div class="otp-label">Your Payout Position</div>
      <div class="otp-code">#${position}</div>
      <p class="otp-expiry">
        You will receive your payout in cycle <strong>${position}</strong> of the circle.
      </p>
    </div>
    <p class="message">
      ${
        isReassignment
          ? 'The circle admin has manually updated your payout position. If you have any questions, please reach out to your circle admin.'
          : 'This is your provisional position. Positions may be reshuffled when the circle activates, depending on the payout logic.'
      }
    </p>
  `;
  return baseTemplate(body);
}
