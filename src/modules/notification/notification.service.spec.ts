import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationGateway } from './notification-gateway';

describe('NotificationService', () => {
  let service: NotificationService;

  const mockPrisma: any = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockMailService = { sendNotification: jest.fn().mockResolvedValue(undefined) };
  const mockGateway = { pushToUser: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: NotificationGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInAppNotification', () => {
    it('should persist an in-app notification record', async () => {
      const mockNotif = { id: 'notif-1', userId: 'user-1', title: 'Test', body: 'Body' };
      mockPrisma.notification.create.mockResolvedValue(mockNotif);

      await service.createInAppNotification('user-1', 'Test', 'Body');

      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });
  });
});
