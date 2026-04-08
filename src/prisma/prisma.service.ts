import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  INestApplication,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Defaults tuned for managed Postgres providers (e.g. Neon).
      max: Number(process.env.PG_POOL_MAX ?? '10'),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? '30000'),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? '15000'),
      keepAlive: true,
      keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_DELAY_MS ?? '0'),
    });

    super({
      adapter: new PrismaPg(pool),
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });

    this.pool = pool;

    this.pool.on('error', (error) => {
      this.logger.error(
        `Unexpected Postgres pool error: ${error.message}`,
        error.stack,
      );
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();

    try {
      await this.pool.end();
    } catch (error) {
      this.logger.warn(
        `Error while closing Postgres pool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
