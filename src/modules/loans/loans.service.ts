import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, LoanStatus, LedgerSourceType, EntryType, MovementType } from '@prisma/client';
import { PrismaService } from '@/prisma';
import { LedgerService } from '../ledger/ledger.service';
import { CreditService } from '../credit/credit.service';
import { LoanEligibilityResponseDto, formatLoanResponse } from './dto/loan.dto';

// 10% of the expected payout is the company fee, always.
const COMPANY_FEE_PERCENT = 10n;

@Injectable()
export class LoanService {
  private readonly logger = new Logger(LoanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly creditService: CreditService,
  ) {}

  // ── Eligibility (read-only) ────────────────────────────────────────────────

  async getLoanEligibility(userId: string, circleId: string): Promise<LoanEligibilityResponseDto> {
    // Check for an existing active loan first — only one allowed at a time
    const activeLoan = await this.prisma.loan.findFirst({
      where: { userId, status: LoanStatus.ACTIVE },
    });

    if (activeLoan) {
      return {
        eligible: false,
        finalCreditScore: 0,
        allowedPercent: 0,
        expectedPayoutAmount: '0',
        maxLoanAmount: '0',
        ineligibilityReason: 'You already have an active loan',
      };
    }

    const result = await this.creditService.getLoanEligibility(userId, circleId);

    return {
      eligible: result.eligible,
      finalCreditScore: result.finalCreditScore,
      allowedPercent: result.allowedPercent,
      expectedPayoutAmount: result.expectedPayoutKobo.toString(),
      maxLoanAmount: result.maxLoanAmountKobo.toString(),
      ineligibilityReason: result.ineligibilityReason,
    };
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  /**
   * Apply for a loan against a circle payout.
   *
   * Atomically (Serializable transaction):
   * 1. Re-validate eligibility inside the transaction (guard against race conditions)
   * 2. Create the Loan record
   * 3. CREDIT the user's wallet with loanAmount via ledger
   */
  async applyLoan(userId: string, circleId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        // ── 1. Guard: one active loan per user ─────────────────────────────
        const existing = await tx.loan.findFirst({
          where: { userId, status: LoanStatus.ACTIVE },
        });

        if (existing) {
          throw new ConflictException('You already have an active loan');
        }

        // ── 2. Re-validate eligibility inside the transaction ──────────────
        const eligibility = await this.creditService.getLoanEligibility(userId, circleId);

        if (!eligibility.eligible) {
          throw new BadRequestException(
            eligibility.ineligibilityReason ?? 'Not eligible for a loan',
          );
        }

        // ── 3. Check no prior loan exists for this circle ──────────────────
        const circleLoans = await tx.loan.findFirst({
          where: {
            userId,
            circleId,
            status: { in: [LoanStatus.ACTIVE, LoanStatus.REPAID] },
          },
        });

        if (circleLoans) {
          throw new ConflictException('A loan has already been taken against this circle');
        }

        // ── 4. Resolve wallet ──────────────────────────────────────────────
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        // ── 5. Calculate amounts (all in kobo) ────────────────────────────
        const payoutAmount = eligibility.expectedPayoutKobo;
        const loanAmount = eligibility.maxLoanAmountKobo;
        const companyFee = (payoutAmount * COMPANY_FEE_PERCENT) / 100n;
        const finalPayout = payoutAmount - loanAmount - companyFee;

        if (finalPayout <= 0n) {
          throw new BadRequestException(
            'Loan amount + fee would exceed expected payout — loan not available',
          );
        }

        // ── 6. Pre-generate IDs for idempotency ───────────────────────────
        const loanId = crypto.randomUUID();
        const ledgerRef = `LOAN-DISBURSE-${loanId}`;

        // ── 7. Create loan record ──────────────────────────────────────────
        const loan = await tx.loan.create({
          data: {
            id: loanId,
            userId,
            circleId,
            payoutAmount,
            loanAmount,
            companyFee,
            finalPayout,
            creditScoreUsed: eligibility.finalCreditScore,
            allowedPercent: eligibility.allowedPercent,
            status: LoanStatus.ACTIVE,
          },
        });

        // ── 8. Credit user wallet with loan amount ─────────────────────────
        await this.ledger.writeEntry(
          {
            walletId: wallet.id,
            entryType: EntryType.CREDIT,
            movementType: MovementType.TRANSFER,
            amount: loanAmount,
            reference: ledgerRef,
            sourceType: LedgerSourceType.LOAN,
            sourceId: loanId,
            metadata: {
              loanId,
              circleId,
              note: 'Loan disbursement — advance on expected ROSCA payout',
            },
          },
          tx,
        );

        this.logger.log(
          `Loan disbursed: loanId=${loanId}, userId=${userId}, amount=${loanAmount} kobo`,
        );

        return formatLoanResponse(loan);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getActiveLoan(userId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { userId, status: LoanStatus.ACTIVE },
    });

    if (!loan) {
      return null;
    }

    return formatLoanResponse(loan);
  }

  async getLoanHistory(userId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return loans.map(formatLoanResponse);
  }

  // ── Payout deduction (called from PayoutService inside its transaction) ────

  /**
   * If the payout recipient has an active loan for this circle:
   * - Deduct loanAmount + companyFee from the payout total
   * - Mark loan as REPAID
   * - Return the net credit amount
   *
   * Called INSIDE PayoutService's Serializable transaction — no new transaction needed.
   */
  async processLoanRepaymentInTx(
    userId: string,
    circleId: string,
    totalPot: bigint,
    tx: Prisma.TransactionClient,
  ): Promise<{ netPayout: bigint; loanRepaid: boolean }> {
    const activeLoan = await tx.loan.findFirst({
      where: { userId, circleId, status: LoanStatus.ACTIVE },
    });

    if (!activeLoan) {
      return { netPayout: totalPot, loanRepaid: false };
    }

    const totalDeduction = activeLoan.loanAmount + activeLoan.companyFee;

    if (totalDeduction >= totalPot) {
      // Safety guard — loan validation should prevent this, but protect the ledger
      this.logger.error(
        `Loan deduction (${totalDeduction}) >= totalPot (${totalPot}) for loanId=${activeLoan.id} — skipping deduction`,
      );
      return { netPayout: totalPot, loanRepaid: false };
    }

    const netPayout = totalPot - totalDeduction;

    await tx.loan.update({
      where: { id: activeLoan.id },
      data: { status: LoanStatus.REPAID, repaidAt: new Date() },
    });

    this.logger.log(
      `Loan repaid: loanId=${activeLoan.id}, deduction=${totalDeduction} kobo, netPayout=${netPayout} kobo`,
    );

    return { netPayout, loanRepaid: true };
  }
}
