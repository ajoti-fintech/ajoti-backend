import { baseTemplate } from './base';

export function welcomeEmailTemplate(fullName: string) {
  const body = `
  <p class="greeting">Welcome to Ajoti, ${fullName}! 🎉</p>
  
  <p class="message">
    We're thrilled to have you on board! Your account has been successfully created, and you're now part of the Ajoti community.
  </p>

  <p class="message">
    Complete your KYC verification to unlock all features and start participating in our roscas. It only takes a few minutes, and it's essential for ensuring a safe and compliant experience for everyone.
  </p>
  
  <p class="message">
    If you have any questions or need assistance getting started, our support team is here to help. Just reply to this email or visit our help center.
    <br><br>
    Best regards,<br>
    The Ajoti Team
  </p>
`;
  return baseTemplate(body);
}

// <div class="btn-container">
//   <a href="https://app.ajoti.com/dashboard" class="dashboard-btn">Go to Dashboard</a>
// </div>
