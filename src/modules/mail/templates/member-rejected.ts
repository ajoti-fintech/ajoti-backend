import { baseTemplate } from './base';

export function memberRejectedTemplate(fullName: string, circleName: string) {
  const body = `
    <h2 class="greeting">Join Request Update</h2>
    <p class="message">
      Hi ${fullName}, unfortunately your request to join
      <strong>${circleName}</strong> was not approved at this time.
    </p>
    <p class="message">
      Any collateral that was reserved for this request has been automatically returned to your wallet.
    </p>
    <div class="instructions">
      <h3>What you can do</h3>
      <ul>
        <li>Browse other available circles that may be a better fit.</li>
        <li>Build your ATI trust score by completing contributions in other groups.</li>
        <li>Contact the circle admin if you believe this was made in error.</li>
      </ul>
    </div>
    <p class="message">
      We hope to see you in a circle soon!
    </p>
  `;
  return baseTemplate(body);
}
