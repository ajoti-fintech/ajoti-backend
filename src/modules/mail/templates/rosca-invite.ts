import { baseTemplate } from './base';

export function roscaInviteEmailTemplate(params: {
  inviteeName: string | null;
  adminName: string;
  circleName: string;
  contributionAmount: number; // in kobo
  frequency: string;
  durationCycles: number;
  acceptUrl: string;
  expiresAt: Date;
}) {
  const naira = (params.contributionAmount / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
  });

  const expiryStr = params.expiresAt.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const greeting = params.inviteeName ? `Hi ${params.inviteeName},` : 'Hello,';
  const freq = params.frequency.charAt(0) + params.frequency.slice(1).toLowerCase();

  const body = `
  <p class="greeting">${greeting}</p>

  <p class="message">
    <strong>${params.adminName}</strong> has invited you to join their private savings circle on Ajoti.
  </p>

  <div class="otp-container">
    <div class="otp-label">Group Invitation</div>
    <p style="font-size: 22px; font-weight: 700; color: #066F5B; margin: 10px 0;">${params.circleName}</p>
    <p style="font-size: 15px; color: #444; margin: 4px 0;">₦${naira} &bull; ${freq} &bull; ${params.durationCycles} cycles</p>
  </div>

  <div class="btn-container">
    <a href="${params.acceptUrl}" class="verify-btn">Accept Invitation</a>
  </div>

  <div class="instructions">
    <h3>Before you accept</h3>
    <ul>
      <li>A collateral amount will be reserved from your wallet on acceptance.</li>
      <li>This invite is personal — it was sent to your email address only.</li>
      <li>The link expires on <strong>${expiryStr}</strong>.</li>
    </ul>
  </div>

  <p class="message">
    If you don't have an Ajoti account yet, you'll need to sign up first before you can accept.<br><br>
    If you weren't expecting this invite, you can safely ignore this email.<br><br>
    Best regards,<br>
    The Ajoti Team
  </p>
`;

  return baseTemplate(body);
}
