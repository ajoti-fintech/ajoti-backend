import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import type { VerificationResult } from './types/kyc.types';

const BASE_URL = 'https://checkmyninbvn.com.ng/api';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('CHECK_NIN_BVN_COM');
    if (!apiKey) {
      throw new Error('CHECK_NIN_BVN_COM is not configured');
    }

    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  // ── Data normalisers ─────────────────────────────────────────────────────────
  // CheckMyNINBVN returns different field names for NIN vs BVN.
  // We normalise both into a common shape so `checkDataMatch` and
  // downstream kyc.service.ts code only deal with one contract.

  private normalizeNinData(raw: Record<string, any>): Record<string, any> {
    return {
      firstName: raw.firstname ?? '',
      lastName: raw.surname ?? '',       // NIN uses "surname"
      middleName: raw.middlename ?? '',
      dateOfBirth: raw.birthdate ?? '',  // NIN uses "birthdate"
      phone: raw.telephoneno ?? '',
      gender: raw.gender ?? '',
      address: raw.residence ?? null,
      photo: raw.photo ?? null,
    };
  }

  private normalizeBvnData(raw: Record<string, any>): Record<string, any> {
    return {
      firstName: raw.firstname ?? '',
      lastName: raw.lastname ?? '',  // BVN uses "lastname"
      middleName: raw.middlename ?? '',
      dateOfBirth: raw.dob ?? '',    // BVN uses "dob"
      phone: raw.phone ?? '',
      email: raw.email ?? '',
      gender: raw.gender ?? '',
      state: raw.state ?? null,
      photo: raw.photo ?? null,
    };
  }

  // ── Match check ──────────────────────────────────────────────────────────────

  private checkDataMatch(
    verifiedData: Record<string, any>,
    providedData: { firstName?: string; lastName?: string; dob?: string },
  ): VerificationResult['matchDetails'] {
    const matchDetails: VerificationResult['matchDetails'] = {};

    if (providedData.firstName && verifiedData.firstName) {
      matchDetails.firstNameMatch =
        providedData.firstName.toLowerCase().trim() ===
        verifiedData.firstName.toLowerCase().trim();
    }

    if (providedData.lastName && verifiedData.lastName) {
      matchDetails.lastNameMatch =
        providedData.lastName.toLowerCase().trim() ===
        verifiedData.lastName.toLowerCase().trim();
    }

    if (providedData.dob && verifiedData.dateOfBirth) {
      matchDetails.dobMatch = providedData.dob === verifiedData.dateOfBirth;
    }

    return matchDetails;
  }

  // ── HTTP helper with retry ───────────────────────────────────────────────────
  // Retries on 5xx / network errors only. 4xx are definitive failures.

  private async postWithRetry<T>(
    path: string,
    body: Record<string, unknown>,
    label: string,
  ): Promise<T> {
    let lastError!: AxiosError<any>;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data } = await this.client.post<T>(path, body);
        return data;
      } catch (err) {
        const axiosError = err as AxiosError<any>;
        const status = axiosError.response?.status;

        // Client errors (4xx) are definitive — no point retrying
        if (status !== undefined && status >= 400 && status < 500) {
          throw axiosError;
        }

        lastError = axiosError;

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * 2 ** attempt;
          this.logger.warn(
            `${label} attempt ${attempt + 1} failed (status=${status ?? 'network'}), retrying in ${delay}ms`,
          );
          await new Promise((res) => setTimeout(res, delay));
        }
      }
    }

    throw lastError;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async verifyNin(
    nin: string,
    firstName: string,
    lastName: string,
    dob?: string,
  ): Promise<VerificationResult> {
    this.logger.log(`NIN verification request [nin=${nin.slice(0, 4)}****]`);

    try {
      const raw = await this.postWithRetry<any>(
        '/nin-verification',
        { nin, consent: true },
        'NIN verification',
      );

      // API returns an error shape when the NIN is not found or invalid
      if (!raw || raw.error || raw.status === 'error' || raw.status === false) {
        this.logger.warn(`NIN verification rejected: ${raw?.message}`);
        return {
          success: false,
          verified: false,
          message: raw?.message || 'NIN verification failed',
          data: null,
          matchDetails: { firstNameMatch: false, lastNameMatch: false, dobMatch: false },
        };
      }

      const normalized = this.normalizeNinData(raw.data ?? raw);
      const matchDetails = this.checkDataMatch(normalized, { firstName, lastName, dob });
      const allMatched = Object.values(matchDetails).every((v) => v !== false);

      this.logger.log(`NIN verification succeeded [allMatched=${allMatched}]`);

      return {
        success: true,
        verified: allMatched,
        message: allMatched
          ? 'NIN Verification Successful and details match'
          : 'NIN Verified but provided data does not match records',
        data: normalized,
        matchDetails,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      const status = axiosError.response?.status;
      this.logger.error(
        `NIN verification error [status=${status}]: ${axiosError.response?.data?.message ?? axiosError.message}`,
      );
      throw new HttpException(
        {
          status: 'error',
          message: axiosError.response?.data?.message || 'NIN Verification failed',
          details: axiosError.response?.data ?? null,
        },
        status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async verifyBvn(
    bvn: string,
    firstName: string,
    lastName: string,
    dob: string,
  ): Promise<VerificationResult> {
    this.logger.log(`BVN verification request [bvn=${bvn.slice(0, 4)}****]`);

    try {
      const raw = await this.postWithRetry<any>(
        '/bvn-verification',
        { bvn, consent: true },
        'BVN verification',
      );

      if (!raw || raw.error || raw.status === 'error' || raw.status === false) {
        this.logger.warn(`BVN verification rejected: ${raw?.message}`);
        return {
          success: false,
          verified: false,
          message: raw?.message || 'BVN verification failed',
          data: null,
          matchDetails: { firstNameMatch: false, lastNameMatch: false, dobMatch: false },
        };
      }

      const normalized = this.normalizeBvnData(raw.data ?? raw);
      const matchDetails = this.checkDataMatch(normalized, { firstName, lastName, dob });
      const allMatched = Object.values(matchDetails).every((v) => v !== false);

      this.logger.log(`BVN verification succeeded [allMatched=${allMatched}]`);

      return {
        success: true,
        verified: allMatched,
        message: allMatched
          ? 'BVN Verification Successful and details match'
          : 'BVN Verified but provided data does not match records',
        data: normalized,
        matchDetails,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      const status = axiosError.response?.status;
      this.logger.error(
        `BVN verification error [status=${status}]: ${axiosError.response?.data?.message ?? axiosError.message}`,
      );
      throw new HttpException(
        {
          status: 'error',
          message: axiosError.response?.data?.message || 'BVN Verification failed',
          details: axiosError.response?.data ?? null,
        },
        status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
