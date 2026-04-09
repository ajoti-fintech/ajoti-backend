import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { ConfigService } from '@nestjs/config';

describe('MailService', () => {
  let service: MailService;

  const mockConfig = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        MAIL_FROM: 'noreply@ajoti.com',
        MAIL_HOST: 'smtp.test.com',
        MAIL_PORT: '587',
        MAIL_USER: 'user',
        MAIL_PASS: 'pass',
      };
      return values[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
