/* eslint-disable prettier/prettier */
import type { StringValue } from 'ms';

export const authConstants: {
  readonly JWT_SECRET: string;
  readonly JWT_EXPIRATION_TIME: StringValue;
} = {
  JWT_SECRET: process.env.JWT_ACCESS_SECRET!,
  // Sync with env - 2 hours default (was hardcoded '1d')
  JWT_EXPIRATION_TIME: (process.env.JWT_ACCESS_EXPIRES_IN as StringValue) || '2h',
};
