import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';
import {
  BankDto,
  BankListResponseDto,
  AccountVerifyResponseDto,
  VerifyBankAccountDto,
} from './banks.dto';

@Injectable()
export class BanksService {
  private readonly logger = new Logger(BanksService.name);

  // Simple in-memory cache — bank list doesn't change often
  private bankCache: BankDto[] | null = null;
  private bankCacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  constructor(private readonly flw: FlutterwaveProvider) {}

  /**
   * GET /api/wallet/banks
   * Returns list of Nigerian banks (cached for 6 hours).
   */
  async getBanks(): Promise<BankListResponseDto> {
    const now = Date.now();
    if (this.bankCache && now < this.bankCacheExpiry) {
      return { banks: this.bankCache };
    }

    const response = await this.flw.getBanks('NG');

    if (response.status !== 'success' || !response.data) {
      this.logger.error('Failed to fetch bank list from FLW', response);
      throw new BadRequestException('Unable to fetch bank list at this time');
    }

    const banks: BankDto[] = response.data.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
    }));

    this.bankCache = banks;
    this.bankCacheExpiry = now + this.CACHE_TTL_MS;

    this.logger.log(`Fetched ${banks.length} banks from FLW`);
    return { banks };
  }

  /**
   * POST /api/wallet/bank/verify
   * Resolves account name using FLW account resolution endpoint.
   * Always call this before initiating a withdrawal.
   */
  async verifyBankAccount(dto: VerifyBankAccountDto): Promise<AccountVerifyResponseDto> {
    const response = await this.flw.resolveAccountName(dto.accountNumber, dto.bankCode);

    if (response.status !== 'success' || !response.data) {
      // FLW error message is user-safe (e.g. "Invalid account number")
      throw new BadRequestException(response.message ?? 'Account verification failed');
    }

    return {
      accountNumber: response.data.account_number,
      accountName: response.data.account_name,
    };
  }
}
