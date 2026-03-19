import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';

@Injectable()
export class VirtualAccountService {
    private readonly logger = new Logger(VirtualAccountService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly flw: FlutterwaveProvider,
    ) { }

    /**
     * Return the user's virtual account, creating one if it doesn't exist.
     *
     * This is idempotent — safe to call on every GET request.
     * The heavy FLW API call only happens once per user's lifetime.
     *
     * BVN rules:
     *   - TEST mode: uses KYC BVN if present, else falls back to FLW's sandbox BVN
     *   - LIVE mode: requires an approved KYC record with a BVN (hard fail otherwise)
     */
    async getOrCreate(userId: string) {
        // Fast path — already provisioned
        const existing = await this.prisma.virtualAccount.findUnique({
            where: { userId },
        });
        if (existing) return existing;

        return this.provision(userId);
    }

    /**
     * Retrieve a virtual account for a user — does NOT auto-create.
     * Use getOrCreate() for the user-facing endpoint.
     */
    async findByUserId(userId: string) {
        return this.prisma.virtualAccount.findUnique({ where: { userId } });
    }

    /**
     * Find a virtual account by its stable tx_ref (AJOTI-VA-{userId}).
     * Called by the webhook handler to look up the wallet on VA credit.
     */
    async findByTxRef(txRef: string) {
        return this.prisma.virtualAccount.findUnique({
            where: { txRef },
            include: { wallet: true },
        });
    }

    // ─── Private: Provisioning ────────────────────────────────────────────────

    private async provision(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { wallet: true, kyc: true },
        });

        if (!user) throw new NotFoundException('User not found');
        if (!user.wallet) {
            throw new BadRequestException(
                'Wallet not found. Cannot provision virtual account without a wallet.',
            );
        }

        // ── BVN Resolution ──────────────────────────────────────────────────────
        let bvn = user.kyc?.bvn ?? null;

        if (!bvn) {
            if (this.flw.isLive) {
                // Live mode — hard fail. BVN is mandatory for permanent VAs in production.
                throw new BadRequestException(
                    'A verified BVN is required to create a virtual account. ' +
                    'Please complete KYC verification first.',
                );
            }
            // Test mode — FLW accepts this sandbox BVN without real KYC
            bvn = this.flw.testBvn;
            this.logger.warn(
                `No KYC BVN for user ${userId} — using test BVN in sandbox mode`,
            );
        }

        // ── Call FLW API ─────────────────────────────────────────────────────────
        const txRef = `AJOTI-VA-${userId}`;
        const narration = `Ajoti Wallet - ${user.firstName} ${user.lastName}`;

        this.logger.log(`Provisioning virtual account for user ${userId}`);

        const response = await this.flw.createVirtualAccount({
            email: user.email,
            is_permanent: true,
            bvn,
            tx_ref: txRef,
            currency: 'NGN',
            narration,
            firstname: user.firstName,
            lastname: user.lastName,
            phonenumber: user.phone ?? undefined,
        });

        if (response.status !== 'success' || !response.data?.account_number) {
            this.logger.error(
                `FLW virtual account creation failed for user ${userId}`,
                response,
            );
            throw new InternalServerErrorException(
                `Virtual account creation failed: ${response.message}`,
            );
        }

        const { data } = response;

        // ── Persist to DB ────────────────────────────────────────────────────────
        const virtualAccount = await this.prisma.virtualAccount.create({
            data: {
                userId,
                walletId: user.wallet.id,
                accountNumber: data.account_number,
                bankName: data.bank_name,
                accountName: data.account_name ?? narration,
                flwRef: data.flw_ref,
                orderRef: data.order_ref,
                txRef,
                currency: 'NGN',
                isActive: true,
                isPermanent: true,
            },
        });

        this.logger.log(
            `Virtual account provisioned: user=${userId}, account=${data.account_number}, bank=${data.bank_name}`,
        );

        return virtualAccount;
    }
}