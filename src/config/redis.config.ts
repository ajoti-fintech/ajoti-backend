import { registerAs } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export type RedisMode = 'url' | 'local' | 'auto';

export type RedisRuntimeConfig = {
  mode: RedisMode;
  selectedMode: 'url' | 'local';
  url?: string;
  host: string;
  port: number;
  password?: string;
  connection: { url: string } | RedisOptions;
  storage: string | RedisOptions;
};

const VALID_REDIS_MODES: RedisMode[] = ['url', 'local', 'auto'];

export default registerAs('redis', (): RedisRuntimeConfig => {
  const mode = (process.env.REDIS_MODE?.trim().toLowerCase() || 'auto') as RedisMode;
  const url = process.env.REDIS_URL?.trim() || undefined;
  const host = process.env.REDIS_HOST?.trim() || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD?.trim() || undefined;

  if (!VALID_REDIS_MODES.includes(mode)) {
    throw new Error(
      `Invalid REDIS_MODE "${process.env.REDIS_MODE}". Supported values are: ${VALID_REDIS_MODES.join(', ')}.`,
    );
  }

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(
      `Invalid REDIS_PORT "${process.env.REDIS_PORT}". REDIS_PORT must be a positive integer.`,
    );
  }

  if (mode === 'url' && !url) {
    throw new Error('REDIS_MODE=url requires REDIS_URL to be set.');
  }

  const selectedMode = mode === 'auto' ? (url ? 'url' : 'local') : mode;
  const localOptions: RedisOptions = {
    host,
    port,
    ...(password ? { password } : {}),
  };

  return {
    mode,
    selectedMode,
    url,
    host,
    port,
    password,
    connection: selectedMode === 'url' ? { url: url! } : localOptions,
    storage: selectedMode === 'url' ? url! : localOptions,
  };
});
