import redisConfig from './redis.config';

describe('redisConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REDIS_MODE;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns hosted redis settings when REDIS_MODE=url', () => {
    process.env.REDIS_MODE = 'url';
    process.env.REDIS_URL = 'redis://default:secret@example.com:6379';

    const config = redisConfig();

    expect(config.mode).toBe('url');
    expect(config.selectedMode).toBe('url');
    expect(config.connection).toEqual({ url: 'redis://default:secret@example.com:6379' });
    expect(config.storage).toBe('redis://default:secret@example.com:6379');
  });

  it('returns local redis settings when REDIS_MODE=local', () => {
    process.env.REDIS_MODE = 'local';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'local-secret';

    const config = redisConfig();

    expect(config.mode).toBe('local');
    expect(config.selectedMode).toBe('local');
    expect(config.connection).toEqual({
      host: '127.0.0.1',
      port: 6380,
      password: 'local-secret',
    });
    expect(config.storage).toEqual({
      host: '127.0.0.1',
      port: 6380,
      password: 'local-secret',
    });
  });

  it('falls back to hosted redis in auto mode when REDIS_URL exists', () => {
    process.env.REDIS_MODE = 'auto';
    process.env.REDIS_URL = 'redis://default:secret@example.com:6379';

    const config = redisConfig();

    expect(config.mode).toBe('auto');
    expect(config.selectedMode).toBe('url');
  });

  it('falls back to local redis in auto mode when REDIS_URL is missing', () => {
    process.env.REDIS_MODE = 'auto';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';

    const config = redisConfig();

    expect(config.mode).toBe('auto');
    expect(config.selectedMode).toBe('local');
    expect(config.connection).toEqual({
      host: 'localhost',
      port: 6379,
    });
  });

  it('fails clearly for invalid REDIS_MODE values', () => {
    process.env.REDIS_MODE = 'remote';

    expect(() => redisConfig()).toThrow(
      'Invalid REDIS_MODE "remote". Supported values are: url, local, auto.',
    );
  });

  it('fails clearly when REDIS_MODE=url is selected without REDIS_URL', () => {
    process.env.REDIS_MODE = 'url';

    expect(() => redisConfig()).toThrow('REDIS_MODE=url requires REDIS_URL to be set.');
  });
});
