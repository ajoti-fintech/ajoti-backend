export type MailJob = {
  id: string;
  to: string;
  subject: string;
  html: string;

  tags?: string[];
  createdAt: string;
};
