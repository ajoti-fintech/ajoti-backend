/* eslint-disable prettier/prettier */
import type {StringValue} from 'ms';

export const authConstants: {
    readonly JWT_SECRET: string;
    readonly JWT_EXPIRATION_TIME: StringValue;
} = {
    JWT_SECRET: process.env.JWT_ACCESS_SECRET!,
    JWT_EXPIRATION_TIME: '1d',
}