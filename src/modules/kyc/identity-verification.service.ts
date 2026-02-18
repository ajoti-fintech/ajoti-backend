import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { YouverifyResponse, VerificationResult } from './types/kyc.types';

@Injectable()
export class IdentityVerificationService {
  private readonly baseUrl = this.configService.get<string>('YOUVERIFY_BASE_URL');
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('YOUVERIFY_API_KEY');
  }

  private validateResponse(response: any): VerificationResult {
    const { data } = response;

    if (!data || data.success === false) {
      return {
        success: false,
        verified: false,
        message: data?.message || 'verification failed',
        data: null,
        matchDetails: {
          firstNameMatch: false,
          lastNameMatch: false,
          dobMatch: false,
        },
      };
    }

    if (!data.data) {
      return {
        success: false,
        verified: false,
        message: 'No verification data returned',
        data: null,
        matchDetails: {
          firstNameMatch: false,
          lastNameMatch: false,
          dobMatch: false,
        },
      };
    }

    return {
      success: true,
      verified: true,
      message: data.message || 'Verification Successful',
      data: data.data,
      matchDetails: {
        firstNameMatch: true,
        lastNameMatch: true,
        dobMatch: true,
      },
    };
  }

  private checkDataMatch(
    verifiedData: any,
    providedData: { firstName?: string; lastName?: string; dob?: string },
  ): VerificationResult['matchDetails'] {
    const matchDetails: VerificationResult['matchDetails'] = {};

    if (providedData.firstName && verifiedData.firstName) {
      matchDetails.firstNameMatch =
        providedData.firstName.toLowerCase().trim() === verifiedData.firstName.toLowerCase().trim();
    }

    if (providedData.lastName && verifiedData.lastName) {
      matchDetails.lastNameMatch =
        providedData.lastName.toLowerCase().trim() === verifiedData.lastName.toLowerCase().trim();
    }

    if (providedData.dob && verifiedData.dateOfBirth) {
      matchDetails.dobMatch = providedData.dob === verifiedData.dateOfBirth;
    }

    return matchDetails;
  }

  async verifyNin(
    nin: string,
    firstName: string,
    lastName: string,
    dob?: string,
  ): Promise<VerificationResult> {
    if (!this.apiKey || !this.baseUrl) {
      throw new Error('NIN API key or base URL is not configured');
    }

    try {
      const payload = {
        id: nin,
        premiumNin: true,
        isSubjectConsent: true,
        validations: {
          data: {
            firstName: firstName,
            lastName: lastName,
            dateOfBirth: dob,
          },
        },
      };

      const response = await axios.post(`${this.baseUrl}/identity/ng/nin`, payload, {
        headers: {
          token: this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      const result = this.validateResponse(response);
      if (!result.success) {
        return result;
      }

      if (firstName || lastName || dob) {
        const matchDetails = this.checkDataMatch(result.data, {
          firstName,
          lastName,
          dob,
        });

        const allMatched = Object.values(matchDetails).every((match) => match !== false);

        return {
          ...result,
          verified: allMatched,
          message: allMatched
            ? 'NIN Verification Successful and details match'
            : 'NIN Verified but data does not match',
          matchDetails,
        };
      }

      return result;
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      throw new HttpException(
        {
          status: 'error',
          message: axiosError.response?.data?.message || 'NIN Verification failed',
          details: axiosError.response?.data?.errors || null,
        },
        axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async verifyBvn(
    bvn: string,
    firstName: string,
    lastName: string,
    dob: string,
  ): Promise<VerificationResult> {
    if (!this.apiKey || !this.baseUrl) {
      throw new Error('BVN API key or base URL is not configured');
    }

    try {
      const payload = {
        id: bvn,
        premiumBVN: true,
        isSubjectConsent: true,
        validations: {
          data: {
            firstName: firstName,
            lastName: lastName,
            dateOfBirth: dob,
          },
        },
      };

      const response = await axios.post(`${this.baseUrl}/identity/ng/bvn`, payload, {
        headers: {
          token: this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      const result = this.validateResponse(response);
      if (!result.success) {
        return result;
      }

      if (firstName || lastName || dob) {
        const matchDetails = this.checkDataMatch(result.data, {
          firstName,
          lastName,
          dob,
        });

        const allMatched = Object.values(matchDetails).every((match) => match !== false);

        return {
          ...result,
          verified: allMatched,
          message: allMatched
            ? 'BVN Verification Successful and details match'
            : 'BVN Verified but data does not match',
          matchDetails,
        };
      }

      return result;
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      throw new HttpException(
        {
          status: 'error',
          message: axiosError.response?.data?.message || 'BVN Verification failed',
          details: axiosError.response?.data?.errors || null,
        },
        axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
