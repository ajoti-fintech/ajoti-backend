import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class MailErrorMapper {
  map(err: unknown): ServiceUnavailableException {
    const code = (err as any)?.code;

    // Authentication issues (wrong creds, app password, etc.)
    if (code === 'EAUTH') {
      return new ServiceUnavailableException({
        message: 'Email service authentication failed. Please try again later.',
        error: 'EMAIL_AUTH_FAILED',
      });
    }

    // Connectivity / network issues
    if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
      return new ServiceUnavailableException({
        message: 'Email service is unreachable. Please try again later.',
        error: 'EMAIL_UNREACHABLE',
      });
    }

    // Fallback
    return new ServiceUnavailableException({
      message: 'Unable to send OTP email. Please try again later.',
      error: 'EMAIL_DELIVERY_FAILED',
    });
  }
}
