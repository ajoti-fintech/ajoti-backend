jest.mock('./users.service', () => ({
  UsersService: class UsersService {},
}));

jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { UsersController } from './users.controller';

describe('UsersController', () => {
  const usersService = {
    getMyProfile: jest.fn(),
    updateMyProfile: jest.fn(),
    verifyPendingEmailChange: jest.fn(),
    closeAccount: jest.fn(),
  };

  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(usersService as any);
  });

  it('wraps GET /users/me responses in the standard success envelope', async () => {
    usersService.getMyProfile.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: '1990-01-01',
      phone: '+2348012345678',
    });

    await expect(controller.getMyProfile('user-1')).resolves.toEqual({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        email: 'user@example.com',
        firstName: 'Ise',
        lastName: 'Afolayan',
        dob: '1990-01-01',
        phone: '+2348012345678',
      },
    });
  });

  it('wraps PATCH /users/me responses in the standard success envelope', async () => {
    usersService.updateMyProfile.mockResolvedValue({
      message: 'Profile updated successfully.',
      data: {
        email: 'user@example.com',
        firstName: 'Ise',
        lastName: 'Afolayan',
        dob: '1990-01-01',
        phone: '+2348012345678',
      },
    });

    await expect(controller.updateMyProfile('user-1', {})).resolves.toEqual({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        email: 'user@example.com',
        firstName: 'Ise',
        lastName: 'Afolayan',
        dob: '1990-01-01',
        phone: '+2348012345678',
      },
    });
  });

  it('wraps POST /users/me/email/verify responses in the standard success envelope', async () => {
    usersService.verifyPendingEmailChange.mockResolvedValue({
      message: 'Email updated successfully.',
      data: {
        email: 'new@example.com',
        firstName: 'Ise',
        lastName: 'Afolayan',
        dob: '1990-01-01',
        phone: '+2348012345678',
      },
    });

    await expect(
      controller.verifyPendingEmailChange('user-1', { otp: '123456' }),
    ).resolves.toEqual({
      success: true,
      message: 'Email updated successfully.',
      data: {
        email: 'new@example.com',
        firstName: 'Ise',
        lastName: 'Afolayan',
        dob: '1990-01-01',
        phone: '+2348012345678',
      },
    });
  });
});
