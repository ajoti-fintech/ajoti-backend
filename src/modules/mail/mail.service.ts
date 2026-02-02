import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter: nodemailer.Transporter;
  constructor(private config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST');
    const port = Number(this.config.get<string>('MAIL_PORT'));
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASS');

    if (!host || !port) {
      throw new Error('MAIL_HOST/MAIL_PORT missing in .env');
    }

    const auth = user && pass ? { user, pass } : undefined;

    if (!auth) throw new Error('MAIL_USER/MAIL_PASS not set');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 456,
      auth,
    });
  }

  async send(to: string, subject: string, html: string) {
    const from = this.config.get<string>('MAIL_FROM');
    const mailOptions = {
      from,
      to,
      subject,
      html,
    };
    await this.transporter.sendMail(mailOptions);
  }
}
