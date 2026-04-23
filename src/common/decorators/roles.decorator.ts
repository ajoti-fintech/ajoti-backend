/* eslint-disable prettier/prettier */
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'MEMBER' | 'ADMIN' | 'SUPERADMIN'>) =>
  SetMetadata(ROLES_KEY, roles);
