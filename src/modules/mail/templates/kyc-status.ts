import { baseTemplate } from './base';

export function kycStatusTemplate(
  fullName: string,
  status: 'APPROVED' | 'REJECTED',
  reason?: string,
) {
  let body = '';

  if (status === 'REJECTED') {
    body = `
      <h2 class="greeting">KYC Submission Needs Attention</h2>
      <p class="message">
        Hi ${fullName}, unfortunately, your KYC submission was rejected.
        ${reason ? `Reason: <strong>${reason}</strong>.<br/><br/>` : ''}
        Please review the reason and resubmit your KYC information.
        If you have any questions, our support team is here to help!
      </p>
    `;
  }

  if (status === 'APPROVED') {
    body = `
      <h2 class="greeting">KYC Approved ✅</h2>
      <p class="message">
        Hi ${fullName}, congratulations! Your KYC submission has been approved.
        You can now enjoy full access to all Ajoti features.
        If you have any questions or need assistance, our support team is here to help!
      </p>
    `;
  }

  return baseTemplate(body);
}
