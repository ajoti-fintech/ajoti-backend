import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashValue } from '../src/common/security/hash';

describe('Wallet API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Mock user for testing
  let mockUserId: string;
  let adminUserId: string;
  let authToken: string;
  let adminAuthToken: string;
  const testPassword = 'TestPassword123!';
  const adminPassword = 'AdminPassword123!';
  const testEmail = `test-${Date.now()}@example.com`;
  const adminEmail = `admin-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-jwt-access-secret';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const user = await prisma.user.create({
      data: {
        email: testEmail,
        firstName: 'Test',
        lastName: 'User',
        password: await hashValue(testPassword),
        dob: new Date('1990-01-01T00:00:00.000Z'),
        gender: 'MALE',
        phone: '08000000000',
        role: 'MEMBER',
        isVerified: true,
        profile: { create: {} },
        kyc: { create: {} },
      },
      select: { id: true },
    });
    mockUserId = user.id;

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        firstName: 'Admin',
        lastName: 'User',
        password: await hashValue(adminPassword),
        dob: new Date('1990-01-01T00:00:00.000Z'),
        gender: 'MALE',
        phone: '08000000001',
        role: 'ADMIN',
        isVerified: true,
        profile: { create: {} },
        kyc: { create: {} },
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/token')
      .type('form')
      .send({
        grant_type: 'password',
        email: testEmail,
        password: testPassword,
      })
      .expect(200);
    authToken = loginResponse.body.accessToken;

    const adminLoginResponse = await request(app.getHttpServer())
      .post('/auth/token')
      .type('form')
      .send({
        grant_type: 'password',
        email: adminEmail,
        password: adminPassword,
      })
      .expect(200);
    adminAuthToken = adminLoginResponse.body.accessToken;
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.walletBucket.deleteMany({
      where: { wallet: { userId: mockUserId } },
    });
    await prisma.ledgerEntry.deleteMany({
      where: { wallet: { userId: mockUserId } },
    });
    await prisma.transaction.deleteMany({
      where: { wallet: { userId: mockUserId } },
    });
    await prisma.wallet.deleteMany({
      where: { userId: mockUserId },
    });
    await prisma.wallet.deleteMany({
      where: { userId: adminUserId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [mockUserId, adminUserId] } },
    });

    await app.close();
  });

  describe('GET /wallet', () => {
    it('should create and return wallet for new user', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Wallet retrieved successfully',
        data: {
          userId: mockUserId,
          currency: 'NGN',
          status: 'ACTIVE',
          balance: {
            total: '0',
            reserved: '0',
            available: '0',
            currency: 'NGN',
          },
        },
      });
    });

    it('should return existing wallet on subsequent requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.userId).toBe(mockUserId);
    });

    it('should return 401 without auth token', async () => {
      await request(app.getHttpServer()).get('/wallet').expect(401);
    });
  });

  describe('GET /wallet/balance', () => {
    it('should return wallet balance', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet/balance')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Balance retrieved successfully',
        data: {
          total: expect.any(String),
          reserved: expect.any(String),
          available: expect.any(String),
          currency: 'NGN',
        },
      });

      // Verify balance values are valid BigInt strings
      expect(BigInt(response.body.data.total)).toBeGreaterThanOrEqual(0n);
      expect(BigInt(response.body.data.reserved)).toBeGreaterThanOrEqual(0n);
      expect(BigInt(response.body.data.available)).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('GET /wallet/balance/naira', () => {
    it('should return balance in Naira as numbers', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet/balance/naira')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          total: expect.any(Number),
          reserved: expect.any(Number),
          available: expect.any(Number),
          currency: 'NGN',
        },
      });

      // Verify values are non-negative
      expect(response.body.data.total).toBeGreaterThanOrEqual(0);
      expect(response.body.data.reserved).toBeGreaterThanOrEqual(0);
      expect(response.body.data.available).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /wallet/stats', () => {
    it('should return wallet statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Statistics retrieved successfully',
        data: {
          totalTransactions: expect.any(Number),
          totalCredits: expect.any(Number),
          totalDebits: expect.any(Number),
          lastTransaction: expect.any(String),
        },
      });
    });
  });

  describe('GET /wallet/buckets', () => {
    it('should return wallet buckets', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet/buckets')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Buckets retrieved successfully',
        data: expect.arrayContaining([
          expect.objectContaining({
            bucketType: expect.any(String),
            reservedAmount: expect.any(String),
          }),
        ]),
      });

      // Should have 4 buckets
      expect(response.body.data).toHaveLength(4);

      // Verify bucket types
      const bucketTypes = response.body.data.map((b: { bucketType: string }) => b.bucketType);
      expect(bucketTypes).toEqual(
        expect.arrayContaining(['ROSCA', 'TARGET', 'FIXED', 'REMITTANCE']),
      );
    });
  });

  describe('GET /wallet/status', () => {
    it('should return wallet status', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          walletId: expect.any(String),
          status: 'ACTIVE',
          isActive: true,
          canWithdraw: true,
          canFund: true,
        },
      });
    });
  });

  describe('GET /wallet/balance/check/:amount', () => {
    it('should check if balance is sufficient', async () => {
      const checkAmount = '100000'; // 1000 NGN in kobo

      const response = await request(app.getHttpServer())
        .get(`/wallet/balance/check/${checkAmount}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          requestedAmount: checkAmount,
          availableBalance: expect.any(String),
          hasSufficientBalance: expect.any(Boolean),
        },
      });
    });

    it('should handle invalid amount', async () => {
      await request(app.getHttpServer())
        .get('/wallet/balance/check/invalid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  // Admin endpoints tests
  describe('Admin Endpoints', () => {
    describe('GET /admin/wallet/user/:userId', () => {
      it('should get wallet by userId (admin only)', async () => {
        const response = await request(app.getHttpServer())
          .get(`/admin/wallet/user/${mockUserId}`)
          .set('Authorization', `Bearer ${adminAuthToken}`)
          .expect(200);

        expect(response.body.data.userId).toBe(mockUserId);
      });
    });
  });
});

// Helper to check if value is one of multiple options
expect.extend({
  toBeOneOf(received, expected: any[]) {
    const pass = expected.includes(received);
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be one of ${expected}`
          : `expected ${received} to be one of ${expected}`,
    };
  },
});
