// src/modules/simulation/sim-prisma.service.ts
/**
 * SimPrismaService
 *
 * Connects to the dedicated simulation database (SIM_NEON_DB_URL) instead of
 * the main application database. All simulation writes go here; the real
 * database is never touched during a simulation run.
 *
 * One-time setup (run after cloning or after schema changes):
 *   npm run prisma:sim:migrate
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class SimPrismaService extends PrismaService {
  constructor() {
    const url = process.env.SIM_NEON_DB_URL;
    if (!url) throw new Error('SIM_NEON_DB_URL is not set — required for simulation endpoints');
    super(url);
  }
}
