import {
    Injectable,
    Logger,
    BadRequestException,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import { verifyHash } from '@/common';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';
import {
    EntryType,
    LedgerSourceType,
    MovementType,
    TransactionStatus,
    TransactionType,
    WalletStatus,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '@/prisma';
import { InitializeWithdrawalDto, WithdrawalResponseDto } from './dto/withdrawal.dto';

/**
 * Withdrawal flow (matches API docs Phase 1 HIGH priorities):
 *
 * POST /api/wallet/withdrawal/initialize
 * ─────────────────────────────────────
 * 1. Load wallet + validate status is ACTIVE
 * 2. SELECT FOR UPDATE (pessimistic lock)
 * 3. Compute available balance from ledger
 * 4. Validate sufficient funds
 * 5. Create Transaction (PENDING)
 * 6. DEBIT ledger (atomic with step 5)
 * 7. Call FLW Transfer API
 * 8a. If FLW call succeeds → return reference (webhook will confirm later)
 * 8b. If FLW call fails   → create REVERSAL CREDIT + mark transaction FAILED
 *
 * POST /api/wallet/withdrawal/verify (webhook — handled in WebhooksService)
 * ─────────────────────────────────
 * - transfer.completed with status=SUCCESSFUL → mark SUCCESS
 * - transfer.completed with status=FAILED     → create REVERSAL CREDIT
 */
@Injectable()
export class WithdrawalService {
    private readonly logger = new Logger(WithdrawalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly flw: FlutterwaveProvider,
    ) { }

    async initializeWithdrawal(
        userId: string,
        dto: InitializeWithdrawalDto,
    ): Promise<WithdrawalResponseDto> {
        const amountKobo = BigInt(dto.amount);
        // FLW takes naira — convert kobo to naira
        const amountNaira = dto.amount / 100;

        // Min withdrawal: 100 NGN (10000 kobo)
        if (amountKobo < 10000n) {
            throw new BadRequestException('Minimum withdrawal amount is NGN 100');
        }

        // Verify transaction PIN
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { transactionPin: true },
        });

        if (!user?.transactionPin) {
            throw new BadRequestException('Transaction PIN not set. Please set a PIN in your profile settings before withdrawing.');
        }

        const pinValid = await verifyHash(dto.transactionPin, user.transactionPin);
        if (!pinValid) {
            throw new UnauthorizedException('Incorrect transaction PIN');
        }

        // Find wallet
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
        });

        if (!wallet) {
            throw new BadRequestException('Wallet not found');
        }

        if (wallet.status !== WalletStatus.ACTIVE) {
            throw new BadRequestException(
                `Wallet is ${wallet.status} — withdrawals not permitted`,
            );
        }

        // Build reference before transaction so we can use it in both FLW and DB
        const withdrawalRef = `WITHDRAWAL-${uuidv4()}`;

        try {
            // Use a Prisma transaction for all DB operations
            const result = await this.prisma.$transaction(async (tx) => {
                // Pessimistic lock — prevents race conditions
                await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE`;

                // Compute available balance
                const { credit, debit, reserved } = await this.computeFullBalance(
                    tx,
                    wallet.id,
                );
                const totalBalance = credit - debit;
                const availableBalance = totalBalance - reserved;

                if (availableBalance < amountKobo) {
                    throw new BadRequestException(
                        `Insufficient balance. Available: ${availableBalance} kobo`,
                    );
                }

                const balanceBefore = totalBalance;
                const balanceAfter = balanceBefore - amountKobo;

                // Create PENDING transaction first
                const transaction = await tx.transaction.create({
                    data: {
                        walletId: wallet.id,
                        provider: 'FLUTTERWAVE',
                        reference: withdrawalRef,
                        amount: amountKobo,
                        currency: 'NGN',
                        status: TransactionStatus.PENDING,
                        type: TransactionType.WITHDRAWAL,
                        metadata: {
                            bankCode: dto.bankCode,
                            accountNumber: dto.accountNumber,
                            accountName: dto.accountName,
                            bankName: dto.bankName,
                            narration: dto.narration,
                            amountNaira,
                        },
                    },
                });

                // DEBIT ledger — money is now "out" before FLW call
                await tx.ledgerEntry.create({
                    data: {
                        walletId: wallet.id,
                        reference: `${withdrawalRef}-DEBIT`,
                        entryType: EntryType.DEBIT,
                        movementType: MovementType.WITHDRAWAL,
                        amount: amountKobo,
                        balanceBefore,
                        balanceAfter,
                        sourceType: LedgerSourceType.TRANSACTION,
                        sourceId: transaction.id,
                        metadata: {
                            bankCode: dto.bankCode,
                            accountNumber: dto.accountNumber,
                            accountName: dto.accountName,
                            bankName: dto.bankName,
                        },
                    },
                });

                return { transaction, balanceBefore, balanceAfter };
            });

            // Now call FLW OUTSIDE the DB transaction
            // If this fails, we create a reversal
            try {
                const flwResponse = await this.flw.initiateTransfer({
                    account_bank: dto.bankCode,
                    account_number: dto.accountNumber,
                    amount: amountNaira,
                    narration: dto.narration ?? `Ajoti withdrawal to ${dto.accountName}`,
                    currency: 'NGN',
                    reference: withdrawalRef,
                    debit_currency: 'NGN',
                    beneficiary_name: dto.accountName,
                });

                if (flwResponse.status !== 'success') {
                    throw new Error(`FLW transfer initiation failed: ${flwResponse.message}`);
                }

                this.logger.log(
                    `Withdrawal initiated: ref=${withdrawalRef}, flwId=${flwResponse.data?.id}`,
                );

                // Update transaction with FLW transfer ID
                await this.prisma.transaction.update({
                    where: { reference: withdrawalRef },
                    data: {
                        metadata: {
                            bankCode: dto.bankCode,
                            accountNumber: dto.accountNumber,
                            accountName: dto.accountName,
                            bankName: dto.bankName,
                            narration: dto.narration,
                            amountNaira,
                            flwTransferId: flwResponse.data?.id,
                            flwStatus: flwResponse.data?.status,
                        },
                    },
                });

                return {
                    reference: withdrawalRef,
                    amount: dto.amount,
                    status: 'PENDING',
                    message:
                        'Withdrawal initiated. Funds will be sent to your account shortly.',
                };
            } catch (flwError) {
                // FLW call failed AFTER we debited the ledger
                // Create compensating CREDIT (reversal)
                this.logger.error(
                    `FLW transfer failed for ${withdrawalRef} — reversing`,
                    flwError,
                );

                await this.createReversalEntry(
                    result.transaction.id,
                    wallet.id,
                    amountKobo,
                    withdrawalRef,
                    `FLW initiation failed: ${(flwError as Error).message}`,
                );

                throw new InternalServerErrorException(
                    'Withdrawal failed. Your balance has been restored.',
                );
            }
        } catch (error) {
            // Re-throw NestJS exceptions (BadRequest, etc.)
            throw error;
        }
    }

    /**
     * Create a compensating CREDIT entry to reverse a failed withdrawal.
     * Per DDD: "create CREDIT reversal entry (ref: REVERSAL-{originalRef}),
     * mark transaction FAILED. Original entry never touched."
     */
    private async createReversalEntry(
        transactionId: string,
        walletId: string,
        amountKobo: bigint,
        originalRef: string,
        reason: string,
    ): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;

            const { credit, debit } = await this.computeFullBalance(tx, walletId);
            const balanceBefore = credit - debit;
            const balanceAfter = balanceBefore + amountKobo;
            const reversalRef = `REVERSAL-${originalRef}`;

            await tx.ledgerEntry.create({
                data: {
                    walletId,
                    reference: reversalRef,
                    entryType: EntryType.CREDIT,
                    movementType: MovementType.WITHDRAWAL,
                    amount: amountKobo,
                    balanceBefore,
                    balanceAfter,
                    sourceType: LedgerSourceType.REVERSAL,
                    sourceId: transactionId,
                    metadata: { reason, originalRef },
                },
            });

            await tx.transaction.update({
                where: { id: transactionId },
                data: {
                    status: TransactionStatus.FAILED,
                    metadata: { reversalRef, reason },
                },
            });
        });
    }

    /**
     * Compute full balance breakdown from ledger entries.
     * - total = credit - debit
     * - reserved = sum of all bucket reserved amounts
     * - available = total - reserved
     */
    private async computeFullBalance(
        tx: any,
        walletId: string,
    ): Promise<{ credit: bigint; debit: bigint; reserved: bigint }> {
        const [entries, buckets] = await Promise.all([
            tx.ledgerEntry.findMany({
                where: { walletId },
                select: { entryType: true, amount: true },
            }),
            tx.walletBucket.aggregate({
                where: { walletId },
                _sum: { reservedAmount: true },
            }),
        ]);

        let credit = BigInt(0);
        let debit = BigInt(0);

        for (const entry of entries) {
            if (entry.entryType === EntryType.CREDIT) {
                credit += entry.amount;
            } else if (entry.entryType === EntryType.DEBIT) {
                debit += entry.amount;
            }
        }

        const reserved = buckets._sum.reservedAmount ?? BigInt(0);

        return { credit, debit, reserved };
    }
}