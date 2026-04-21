import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type EmailProvider = 'MAILTRAP' | 'GOOGLE';

@Injectable()
export class MailService {
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const provider = (
      this.config.get<string>('EMAIL_SERVICE') ?? 'GOOGLE'
    ).toUpperCase() as EmailProvider;

    const host = this.config.getOrThrow<string>(`${provider}_HOST`);
    const port = Number(this.config.getOrThrow<string>(`${provider}_PORT`));
    const user = this.config.getOrThrow<string>(`${provider}_USER`);
    const pass = this.config.getOrThrow<string>(`${provider}_PASS`);
    this.from = this.config.getOrThrow<string>(`${provider}_FROM`);

    // Port 465 → SMTPS (secure: true).  All other ports → STARTTLS (requireTLS).
    const isSMTPS = port === 465;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSMTPS,
      requireTLS: !isSMTPS,
      auth: { user, pass },
      tls: { minVersion: 'TLSv1.2' },
    });
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, html });
  }
}
