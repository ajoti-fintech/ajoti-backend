import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';

// Services
import { SuperadminUsersService } from './superadmin-users.service';
import { SuperadminKycService } from './superadmin-kyc.service';
import { SuperadminAnalyticsService } from './superadmin-analytics.service';
import { SuperadminAuditService } from './superadmin-audit.service';
import { SuperadminGovernanceService } from './superadmin-governance.service';

// Controllers
import { SuperadminUsersController } from './controllers/superadmin-users.controller';
import { SuperadminKycController } from './controllers/superadmin-kyc.controller';
import { SuperadminAnalyticsController } from './controllers/superadmin-analytics.controller';
import { SuperadminAuditController } from './controllers/superadmin-audit.controller';
import { SuperadminGovernanceController } from './controllers/superadmin-governance.controller';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [
    SuperadminUsersController,
    SuperadminKycController,
    SuperadminAnalyticsController,
    SuperadminAuditController,
    SuperadminGovernanceController,
  ],
  providers: [
    SuperadminUsersService,
    SuperadminKycService,
    SuperadminAnalyticsService,
    SuperadminAuditService,
    SuperadminGovernanceService,
  ],
})
export class SuperadminModule {}
