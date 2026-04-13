// src/modules/simulation/simulation.controller.ts
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SimulationService } from './simulation.service';
import { ManualSimConfigDto } from './dto/simulation.dto';

@ApiTags('Super Admin — Simulations')
@Controller('superadmin/simulate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  // ── POST /superadmin/simulate/auto ───────────────────────────────────────

  @Post('auto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Super Admin] Run the automated 3-circle simulation',
    description: `
Runs a fixed automated simulation of three ROSCA circles with different member behaviours:

- **Circle A** — Best case: all 4 members on-time every cycle, fair peer ratings (4–5)
- **Circle B** — Mixed: one member late in cycle 2, one misses cycle 3, one gives malicious peer ratings (1s)
- **Circle C** — Worst case: member defaults on cycles 1+2, receives payout cycle 3, defaults cycle 4 (post-payout default); another member has a loan deducted from their payout

**Data safety**: All records are created with a \`sim_<timestamp>\` prefix and are deleted
automatically after the simulation completes. No production data is touched.

Returns per-circle event logs and final trust scores for all members.`,
  })
  async runAutoSimulation() {
    const result = await this.simulationService.runAutoSimulation();
    return {
      success: true,
      message: 'Auto simulation completed and cleaned up',
      data: result,
    };
  }

  // ── POST /superadmin/simulate/manual ─────────────────────────────────────

  @Post('manual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Super Admin] Run a manual cycle-by-cycle simulation',
    description: `
Runs a custom simulation driven by the request body. Accepts a full circle configuration
with per-cycle contribution timing (\`on_time\` / \`late\` / \`missed\`), optional extra trust
events after each cycle, and optional peer reviews at the end.

**Data safety**: All records are created with a \`sim_<timestamp>\` prefix and deleted
automatically after the simulation completes. No production data is touched.

Returns an event log and final trust scores for each simulated member.`,
  })
  async runManualSimulation(@Body() dto: ManualSimConfigDto) {
    const result = await this.simulationService.runManualSimulation(dto);
    return {
      success: true,
      message: 'Manual simulation completed and cleaned up',
      data: result,
    };
  }
}
