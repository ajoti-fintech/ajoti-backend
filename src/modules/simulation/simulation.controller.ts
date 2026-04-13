// src/modules/simulation/simulation.controller.ts
import { Controller, Post, Get, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SimulationService } from './simulation.service';
import { SandboxService } from './sandbox.service';
import { ManualSimConfigDto } from './dto/simulation.dto';
import {
  CreateSandboxUsersDto,
  CreateSandboxCircleDto,
  RunSandboxCycleDto,
  ApplySandboxLoanDto,
} from './dto/sandbox.dto';

@ApiTags('Super Admin — Simulations')
@Controller('superadmin/simulate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SimulationController {
  constructor(
    private readonly simulationService: SimulationService,
    private readonly sandboxService: SandboxService,
  ) {}

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

  // ── SANDBOX ───────────────────────────────────────────────────────────────
  // Persistent endpoints — data stays in the sim DB after each call.
  // Use runId to chain multiple calls into one test session.
  // Clean up with DELETE /sandbox/reset/:runId when done.

  @Post('sandbox/users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[Sandbox] Create funded sim users',
    description: 'Creates N MEMBER users in the sim DB with funded wallets. Returns a runId you pass to all subsequent sandbox calls.',
  })
  async sandboxCreateUsers(@Body() dto: CreateSandboxUsersDto) {
    const data = await this.sandboxService.createUsers(dto);
    return { success: true, data };
  }

  @Post('sandbox/circle')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[Sandbox] Create and activate a circle',
    description: 'Creates a circle with the given members, handles memberships, and activates it. Pass memberIds from a prior /sandbox/users call.',
  })
  async sandboxCreateCircle(@Body() dto: CreateSandboxCircleDto) {
    const data = await this.sandboxService.createCircle(dto);
    return { success: true, data };
  }

  @Post('sandbox/cycle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Sandbox] Run one cycle (contributions + payout)',
    description: `
Processes a single cycle for the given circle. Specify per-member timing:
- **on_time** — contributes within deadline (no penalty)
- **late** — contributes past deadline (late penalty applied)
- **skip** — no contribution; \`missed_payment\` trust event fires automatically after payout

Data persists in the sim DB — query ledger, trust scores, and payout history after this call.`,
  })
  async sandboxRunCycle(@Body() dto: RunSandboxCycleDto) {
    const data = await this.sandboxService.runCycle(dto);
    return { success: true, data };
  }

  @Post('sandbox/loan')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[Sandbox] Apply a loan for a sim user',
    description: 'Applies a pre-payout loan for a sim user in a given circle. Call this before the cycle where the user receives their payout to test loan deduction.',
  })
  async sandboxApplyLoan(@Body() dto: ApplySandboxLoanDto) {
    const data = await this.sandboxService.applyLoan(dto);
    return { success: true, data };
  }

  @Get('sandbox/ledger/:walletId')
  @ApiOperation({
    summary: '[Sandbox] Inspect ledger entries for a wallet',
    description: 'Returns all ledger entries for a sim wallet in chronological order, plus a reconciliation check: recomputes the running balance from raw entries and flags any discrepancy against the stored balanceAfter.',
  })
  async sandboxInspectLedger(@Param('walletId') walletId: string) {
    const data = await this.sandboxService.inspectLedger(walletId);
    return { success: true, data };
  }

  @Get('sandbox/reconcile/:runId')
  @ApiOperation({
    summary: '[Sandbox] Reconcile all wallets in a run',
    description: 'For every wallet belonging to this runId (sim users + system wallets), recomputes the balance from ledger entries and compares against the stored balanceAfter. Reports any discrepancies.',
  })
  async sandboxReconcile(@Param('runId') runId: string) {
    const data = await this.sandboxService.reconcileRun(runId);
    return { success: true, data };
  }

  @Delete('sandbox/reset/:runId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Sandbox] Delete all sim data for a runId',
    description: 'Permanently removes all records (users, wallets, ledger entries, circles, memberships, payouts, loans, trust stats) for the given runId from the sim DB.',
  })
  async sandboxReset(@Param('runId') runId: string) {
    const data = await this.sandboxService.resetRun(runId);
    return { success: true, message: `Deleted ${data.deleted} sim users and all related records`, data };
  }
}
