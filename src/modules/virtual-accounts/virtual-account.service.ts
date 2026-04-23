import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FlutterwaveProvider,
  FlwVirtualAccountResponse,
} from '../flutterwave/flutterwave.provider';
import { WalletService } from '../wallet/wallet.service';
import { FieldEncryptionService } from '@/common/encryption/field-encryption.service';

@Injectable()
export class VirtualAccountService {
  private readonly logger = new Logger(VirtualAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flw: FlutterwaveProvider,
    private readonly walletService: WalletService,
    private readonly encryption: FieldEncryptionService,
  ) {}

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

  /**
   * Pull latest VA details from Flutterwave using order_ref and sync local row.
   * Internal helper used by service flows (not exposed to users directly).
   */
  async refreshFromProvider(userId: string) {
    const local = await this.getOrCreate(userId);
    const provider = await this.flw.getVirtualAccount(local.orderRef);

    if (provider.status !== 'success' || !provider.data?.account_number) {
      throw new InternalServerErrorException(
        provider.message || 'Failed to fetch virtual account from provider',
      );
    }

    const data = provider.data;
    const updated = await this.prisma.virtualAccount.update({
      where: { id: local.id },
      data: {
        accountNumber: data.account_number ?? local.accountNumber,
        bankName: data.bank_name ?? local.bankName,
        accountName: data.account_name ?? local.accountName,
        flwRef: data.flw_ref ?? local.flwRef,
        orderRef: data.order_ref ?? local.orderRef,
        isActive: this.resolveProviderAccountActive(data),
      },
    });

    return {
      virtualAccount: updated,
      provider,
    };
  }

  /**
   * Internal BVN sync from verified KYC.
   * Best effort: if the user has no VA yet, do nothing.
   * If provider call fails, we log and continue so KYC flow isn't blocked.
   */
  async syncBvnFromKyc(userId: string, bvn: string): Promise<void> {
    const existingVa = await this.prisma.virtualAccount.findUnique({
      where: { userId },
    });
    if (!existingVa) return;

    try {
      const provider = await this.flw.updateVirtualAccountBvn(existingVa.orderRef, bvn);
      if (provider.status !== 'success') {
        this.logger.warn(
          `Provider BVN sync did not succeed for user ${userId}: ${provider.message}`,
        );
        return;
      }

      await this.prisma.virtualAccount.update({
        where: { id: existingVa.id },
        data: {
          accountNumber: provider.data.account_number ?? existingVa.accountNumber,
          bankName: provider.data.bank_name ?? existingVa.bankName,
          accountName: provider.data.account_name ?? existingVa.accountName,
          flwRef: provider.data.flw_ref ?? existingVa.flwRef,
          orderRef: provider.data.order_ref ?? existingVa.orderRef,
          isActive: this.resolveProviderAccountActive(provider.data),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to sync VA BVN from KYC for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Delete a user's virtual account at provider and local DB.
   */
  async deleteForUser(userId: string) {
    const existing = await this.prisma.virtualAccount.findUnique({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('Virtual account not found');

    const provider = await this.flw.deleteVirtualAccount(existing.orderRef);
    if (provider.status !== 'success') {
      throw new InternalServerErrorException(
        provider.message || 'Provider failed to delete virtual account',
      );
    }

    await this.prisma.virtualAccount.delete({
      where: { id: existing.id },
    });

    return {
      deletedVirtualAccount: existing,
      provider,
    };
  }

  /**
   * Admin: fetch any VA directly from provider by order_ref.
   */
  async getProviderVirtualAccountByOrderRef(orderRef: string) {
    return this.flw.getVirtualAccount(orderRef);
  }

  // ─── Private: Provisioning ────────────────────────────────────────────────

  private async provision(userId: string) {
    const txRef = this.buildVirtualAccountTxRef(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true, kyc: true },
    });

    if (!user) throw new NotFoundException('User not found');
    const wallet = user.wallet ?? (await this.walletService.getOrCreateWallet(userId));

    // ── BVN Resolution ──────────────────────────────────────────────────────
    // BVN is stored encrypted in the DB; decrypt before sending to FLW
    const rawKycBvn = user.kyc?.bvn
      ? this.encryption.decrypt(user.kyc.bvn)
      : null;
    let bvn = rawKycBvn;

    if (this.flw.isLive && !user.kyc?.bvnVerifiedAt) {
      throw new BadRequestException('BVN must be verified before creating a live virtual account.');
    }

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
      this.logger.warn(`No KYC BVN for user ${userId} — using test BVN in sandbox mode`);
    }

    // ── Call FLW API ─────────────────────────────────────────────────────────
    const narration = `Ajoti Wallet - ${user.firstName} ${user.lastName}`;

    this.logger.log(`Provisioning virtual account for user ${userId}`);

    let response: FlwVirtualAccountResponse;
    try {
      response = await this.flw.createStaticVirtualAccount({
        email: user.email,
        bvn,
        tx_ref: txRef,
        currency: 'NGN',
        narration,
        firstname: user.firstName,
        lastname: user.lastName,
        phonenumber: user.phone ?? undefined,
      });
    } catch (error) {
      // If FLW rejects due duplicate tx_ref while another request has already
      // provisioned this user, return the existing record instead of failing.
      const existing = await this.prisma.virtualAccount.findUnique({
        where: { userId },
      });
      if (existing) {
        this.logger.warn(
          `Provider create call failed but VA already exists for user ${userId}; returning existing row`,
        );
        return existing;
      }
      throw error;
    }

    if (
      response.status !== 'success' ||
      !response.data?.account_number ||
      !response.data?.bank_name ||
      !response.data?.flw_ref ||
      !response.data?.order_ref
    ) {
      const existing = await this.prisma.virtualAccount.findUnique({
        where: { userId },
      });
      if (existing) {
        this.logger.warn(
          `Provider returned non-success but VA already exists for user ${userId}; returning existing row`,
        );
        return existing;
      }
      this.logger.error(`FLW virtual account creation failed for user ${userId}`, response);
      throw new InternalServerErrorException(
        `Virtual account creation failed: ${response.message}`,
      );
    }

    const { data } = response;

    // ── Persist to DB ────────────────────────────────────────────────────────
    try {
      const virtualAccount = await this.prisma.virtualAccount.create({
        data: {
          userId,
          walletId: wallet.id,
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
    } catch (error) {
      // Handles race conditions: concurrent requests for same user may both
      // reach provider, but only one DB row can be stored.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.virtualAccount.findUnique({
          where: { userId },
        });
        if (existing) {
          this.logger.warn(
            `Virtual account already exists after concurrent provision for user ${userId}; returning existing row`,
          );
          return existing;
        }
      }
      throw error;
    }
  }

  private buildVirtualAccountTxRef(userId: string): string {
    return `AJOTI-VA-${userId}`;
  }

  private resolveProviderAccountActive(data: {
    is_active?: boolean;
    response_message?: string;
  }): boolean {
    if (typeof data.is_active === 'boolean') return data.is_active;
    if (!data.response_message) return true;
    return !/inactive|deleted/i.test(data.response_message);
  }
}
