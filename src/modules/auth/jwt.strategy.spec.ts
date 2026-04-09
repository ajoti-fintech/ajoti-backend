jest.mock('../users/users.service', () => ({
  UsersService: class UsersService {},
}));

import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const usersService = {
    findAuthUserById: jest.fn(),
  };

  const config = {
    get: jest.fn().mockReturnValue('test-secret'),
  };

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(usersService as any, config as any);
  });

  it('returns the minimal auth payload for verified users', async () => {
    usersService.findAuthUserById.mockResolvedValue({
      id: 'user-1',
      role: 'MEMBER',
      isVerified: true,
    });

    await expect(
      strategy.validate({ sub: 'user-1', role: 'MEMBER' }),
    ).resolves.toEqual({
      userId: 'user-1',
      role: 'MEMBER',
    });
  });

  it('rejects unverified users from JWT validation', async () => {
    usersService.findAuthUserById.mockResolvedValue({
      id: 'user-1',
      role: 'MEMBER',
      isVerified: false,
    });

    await expect(
      strategy.validate({ sub: 'user-1', role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
