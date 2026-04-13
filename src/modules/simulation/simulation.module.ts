// src/modules/simulation/simulation.module.ts
/**
 * SimulationModule
 *
 * Wires up all services needed to run a full ROSCA simulation, but routes
 * every database write to the dedicated simulation database (SIM_NEON_DB_URL)
 * by providing SimPrismaService as the PrismaService token.
 *
 * The real database is never touched during a simulation run.
 *
 * One-time setup (run once after cloning or schema changes):
 *   npm run prisma:sim:migrate
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';
import { LedgerService } from '../ledger/ledger.service';
import { TrustService } from '../trust/trust.service';
import { CircleService } from '../rosca/services/circle.service';
import { MembershipService } from '../rosca/services/membership.service';
import { ContributionService } from '../contribution/contribution.service';
import { PayoutService } from '../payout/payout.service';
import { LoanService } from '../loans/loans.service';
import { CreditService } from '../credit/credit.service';
import { ExternalCreditService } from '../credit/external-credit.service';
import { PeerReviewService } from '../peer-review/peer-review.service';
import { NotificationService } from '../notification/notification.service';
import { TrustModule } from '../trust/trust.module';
import { PayoutModule } from '../payout/payout.module';
import { LoanModule } from '../loans/loans.module';
import { CreditModule } from '../credit/credit.module';
import { SimPrismaService } from './sim-prisma.service';
import { SimNotificationService } from './sim-notification.service';
import { SimulationService } from './simulation.service';
import { SandboxService } from './sandbox.service';
import { SimulationController } from './simulation.controller';

@Module({
  imports: [
    AuthModule,
    // These module imports pull in transitive deps (BullMQ queues, mail, etc.)
    // that the re-provided services below depend on.
    TrustModule,
    PayoutModule,
    LoanModule,
    CreditModule,
    // Register the auth-events queue in this module's scope so that
    // PayoutService (re-provided below) can inject it via @InjectQueue.
    BullModule.registerQueue({ name: AUTH_EVENTS_QUEUE }),
  ],
  providers: [
    // SimPrismaService connects to SIM_NEON_DB_URL.
    // Providing it as the PrismaService token means every service in this
    // module writes to the simulation database instead of the real one.
    SimPrismaService,
    { provide: PrismaService, useExisting: SimPrismaService },

    LedgerService,
    TrustService,
    CircleService,
    MembershipService,
    ContributionService,
    PayoutService,
    LoanService,
    CreditService,
    ExternalCreditService,
    PeerReviewService,
    // No-op: suppresses emails and DB writes for sim users.
    { provide: NotificationService, useClass: SimNotificationService },

    SimulationService,
    SandboxService,
  ],
  controllers: [SimulationController],
})
export class SimulationModule {}
