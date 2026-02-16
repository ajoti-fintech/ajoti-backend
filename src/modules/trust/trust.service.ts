import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class TrustService {
  constructor(private prisma: PrismaService) {}

  // =========================================================================
  // TRUST SCORE — SYSTEM DERIVED ONLY (R9)
  // =========================================================================

  async updateTrustScore(userId: string, event: { onTime: boolean }, tx: Prisma.TransactionClient) {
    const stats = await tx.userTrustStats.upsert({
      where: { userId },
      update: {},
      create: { userId, trustScore: 10 }, // New users start at 10?
    });

    const delta = event.onTime ? 1 : -5; // Harsh penalty for late payment
    const newScore = Math.max(0, Math.min(100, stats.trustScore + delta));

    await tx.userTrustStats.update({
      where: { userId },
      data: {
        trustScore: newScore,
        totalOnTimePayments: event.onTime ? { increment: 1 } : undefined,
        totalLatePayments: event.onTime ? undefined : { increment: 1 },
        consecutiveLatePayments: event.onTime ? 0 : { increment: 1 },
        lastUpdated: new Date(),
      },
    });
  }
  async getTrustScore(userId: string) {
    const stats = await this.prisma.userTrustStats.findUnique({
      where: { userId },
    });

    return stats || { trustScore: 1, userId };
  }
}
