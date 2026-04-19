import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { IdentityVerificationService } from './identity-verification.service';
import { KYCStatus, KYCStep, KYC } from '@prisma/client';
import {
  VerifyNinDto,
  VerifyBvnDto,
  VerifyNokDto,
  KycResponseDto,
  VerifyAddressDto,
  VerifyPhotoDto,
  VerifyProofOfAddressDto,
} from './dto/kyc.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import { AUTH_EVENTS_QUEUE, AuthJobName } from '../auth/auth.events';
import { VirtualAccountService } from '../virtual-accounts/virtual-account.service';
import { FieldEncryptionService } from '@/common/encryption/field-encryption.service';

type PhotoFiles = {
  selfie: Express.Multer.File;
  front: Express.Multer.File;
  back?: Express.Multer.File;
};

/** Magic NIN that bypasses external verification and auto-approves all KYC tiers in non-production */
const TEST_NIN = '00000000000';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly identityService: IdentityVerificationService,
    private readonly fieldEncryption: FieldEncryptionService,
    @InjectQueue(AUTH_EVENTS_QUEUE) private readonly authEventsQueue: Queue,
    private readonly virtualAccountService: VirtualAccountService,
  ) {}

  private fileToPublicUrl(file: Express.Multer.File) {
    const rel = path.relative(process.cwd(), file.path).split(path.sep).join('/');
    return `/${rel}`;
  }

  /** Returns true when the stored NIN for a KYC record is the magic test NIN */
  private isTestBypass(kycRecord: KYC): boolean {
    return (
      process.env.NODE_ENV !== 'production' &&
      !!kycRecord.nin &&
      this.fieldEncryption.decrypt(kycRecord.nin) === TEST_NIN
    );
  }

  /**
   * Initialize KYC record for a user if it doesn't exist
   */
  async initializeKyc(userId: string): Promise<KYC> {
    const existingKyc = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (existingKyc) {
      return existingKyc;
    }

    return this.prisma.kYC.create({
      data: {
        userId,
        status: KYCStatus.NOT_SUBMITTED,
        step: KYCStep.NIN_REQUIRED,
      },
    });
  }

  /**
   * Get KYC status for a user
   */
  async getKycStatus(userId: string): Promise<KycResponseDto> {
    const kyc = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kyc) {
      throw new NotFoundException('KYC record not found');
    }

    // Backfill kycLevel for records that pre-date the kycLevel column
    if (kyc.kycLevel === 0 && kyc.step === KYCStep.SUBMITTED) {
      const backfilled = await this.prisma.kYC.update({
        where: { userId },
        data: { kycLevel: 1, status: KYCStatus.APPROVED },
      });
      return this.mapToResponseDto(backfilled);
    }

    return this.mapToResponseDto(kyc);
  }

  /**
   * Verify NIN and update KYC record
   */
  async verifyNin(userId: string, verifyNinDto: VerifyNinDto): Promise<KycResponseDto> {
    const { nin, firstName, lastName, dob } = verifyNinDto;

    let kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      kycRecord = await this.initializeKyc(userId);
    }

    // Idempotent: if NIN is already verified, return current status without re-processing
    if (kycRecord.ninVerifiedAt) {
      return this.mapToResponseDto(kycRecord);
    }

    if (kycRecord.step !== KYCStep.NIN_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.NIN_REQUIRED}`,
      );
    }

    const identityVerification = await this.identityService.verifyNin(
      nin,
      firstName,
      lastName,
      dob,
    );

    if (!identityVerification.verified) {
      throw new UnprocessableEntityException(
        identityVerification.message || 'NIN verification failed',
      );
    }

    const updatedKyc = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      return tx.kYC.update({
        where: { userId },
        data: {
          nin: this.fieldEncryption.encrypt(nin),
          ninVerifiedAt: new Date(),
          step: KYCStep.BVN_REQUIRED,
          status: KYCStatus.PENDING,
          updatedAt: new Date(),
        },
      });
    });

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Verify BVN and update KYC record
   */
  async verifyBvn(userId: string, verifyBvnDto: VerifyBvnDto): Promise<KycResponseDto> {
    const { bvn, firstName, lastName, dob } = verifyBvnDto;

    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please verify NIN first.');
    }

    // Idempotent: if BVN is already verified, return current status without re-processing
    if (kycRecord.bvnVerifiedAt) {
      return this.mapToResponseDto(kycRecord);
    }

    if (kycRecord.step !== KYCStep.BVN_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.BVN_REQUIRED}`,
      );
    }

    const identityVerification = await this.identityService.verifyBvn(
      bvn,
      firstName,
      lastName,
      dob,
    );

    if (!identityVerification.verified) {
      throw new UnprocessableEntityException(
        identityVerification.message || 'BVN verification failed',
      );
    }

    const updatedKyc = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      return tx.kYC.update({
        where: { userId },
        data: {
          bvn: this.fieldEncryption.encrypt(bvn),
          bvnVerifiedAt: new Date(),
          step: KYCStep.NOK_REQUIRED,
          status: KYCStatus.PENDING,
          updatedAt: new Date(),
        },
      });
    });

    await this.virtualAccountService.syncBvnFromKyc(userId, bvn);

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit Next of Kin — completes Level 1 KYC (auto-approved for all users).
   * Level 1 grants single ₦50,000 / daily ₦300,000 transaction limits.
   */
  async submitNextOfKin(userId: string, verifyNokDto: VerifyNokDto): Promise<KycResponseDto> {
    const { nextOfKinName, nextOfKinRelationship, nextOfKinPhone } = verifyNokDto;

    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    // Idempotent: if NOK already submitted or Level 1 already granted, return current status.
    // Also backfill kycLevel=1 for records that pre-date the kycLevel column (step=SUBMITTED
    // but kycLevel=0 due to migration default).
    if (kycRecord.submittedAt || kycRecord.kycLevel >= 1) {
      if (kycRecord.kycLevel === 0 && kycRecord.step === KYCStep.SUBMITTED) {
        const backfilled = await this.prisma.kYC.update({
          where: { userId },
          data: { kycLevel: 1, status: KYCStatus.APPROVED },
        });
        return this.mapToResponseDto(backfilled);
      }
      return this.mapToResponseDto(kycRecord);
    }

    if (kycRecord.step !== KYCStep.NOK_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.NOK_REQUIRED}`,
      );
    }

    // Level 1 is always auto-approved — NIN + BVN + NOK is the CBN baseline tier
    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        nextOfKinName,
        nextOfKinRelationship,
        nextOfKinPhone,
        step: KYCStep.SUBMITTED,
        status: KYCStatus.APPROVED,
        kycLevel: 1,
        submittedAt: new Date(),
        reviewedAt: new Date(),
        reviewedBy: 'SYSTEM_AUTO_APPROVE',
        updatedAt: new Date(),
      },
    });

    this.logger.log(`KYC Level 1 auto-approved for userId=${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });

    await this.authEventsQueue.add(
      AuthJobName.KYC_STATUS_CHANGED,
      {
        userId,
        email: user?.email,
        fullName: user ? `${user.firstName} ${user.lastName}` : '',
        status: 'APPROVED',
        timestamp: new Date().toISOString(),
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit Address information for verification (legacy step, kept for backwards compat)
   */
  async submitAddress(userId: string, verifyAddressDto: VerifyAddressDto): Promise<KycResponseDto> {
    const { address, city, state, lga, country } = verifyAddressDto;

    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    if (kycRecord.step !== KYCStep.ADDRESS_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.ADDRESS_REQUIRED}`,
      );
    }

    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        address,
        city,
        state,
        lga,
        country,
        step: KYCStep.SUBMITTED,
        status: KYCStatus.PENDING,
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit government ID (selfie + photo ID) for Level 2 KYC upgrade.
   * Requires existing Level 1 approval. Superadmin reviews; test NIN auto-approves.
   * Level 2 grants single ₦100,000 / daily ₦500,000.
   */
  async submitPhoto(
    userId: string,
    verifyPhotoDto: VerifyPhotoDto,
    files: PhotoFiles,
  ): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    // Must be Level 1 approved and at the SUBMITTED step (i.e. not mid-review)
    if (kycRecord.kycLevel < 1 || kycRecord.status !== KYCStatus.APPROVED || kycRecord.step !== KYCStep.SUBMITTED) {
      throw new BadRequestException(
        'Level 2 upgrade requires an approved Level 1 KYC. Please complete Level 1 first.',
      );
    }

    const { selfie, front, back } = files;
    const selfieUrl = this.fileToPublicUrl(selfie);
    const frontUrl = this.fileToPublicUrl(front);
    const backUrl = back ? this.fileToPublicUrl(back) : null;

    const testBypass = this.isTestBypass(kycRecord);

    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        selfieUrl,
        governmentIdType: verifyPhotoDto.governmentIdType,
        governmentIdFrontUrl: frontUrl,
        governmentIdBackUrl: backUrl,
        selfieUploadedAt: new Date(),
        governmentIdUploadedAt: new Date(),
        address: verifyPhotoDto.address,
        city: verifyPhotoDto.city,
        state: verifyPhotoDto.state,
        lga: verifyPhotoDto.lga ?? null,
        country: verifyPhotoDto.country,
        step: testBypass ? KYCStep.SUBMITTED : KYCStep.PHOTO_REQUIRED,
        status: testBypass ? KYCStatus.APPROVED : KYCStatus.PENDING,
        ...(testBypass ? { kycLevel: 2, reviewedAt: new Date(), reviewedBy: 'SYSTEM_TEST_BYPASS', rejectionReason: null } : {}),
        updatedAt: new Date(),
      },
    });

    if (testBypass) {
      this.logger.warn(`[TEST BYPASS] KYC Level 2 auto-approved for userId=${userId}`);
    }

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit proof of address for Level 3 KYC upgrade.
   * Requires existing Level 2 approval. Superadmin reviews; test NIN auto-approves.
   * Level 3 grants single ₦5,000,000 / daily ₦25,000,000.
   */
  async submitProofOfAddress(
    userId: string,
    verifyProofOfAddressDto: VerifyProofOfAddressDto,
    file: Express.Multer.File,
  ): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    // Must be Level 2 approved and at SUBMITTED step
    if (kycRecord.kycLevel < 2 || kycRecord.status !== KYCStatus.APPROVED || kycRecord.step !== KYCStep.SUBMITTED) {
      throw new BadRequestException(
        'Level 3 upgrade requires an approved Level 2 KYC. Please complete Level 2 first.',
      );
    }

    const proofOfAddressUrl = this.fileToPublicUrl(file);
    const testBypass = this.isTestBypass(kycRecord);

    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        proofOfAddressUrl,
        proofOfAddressType: verifyProofOfAddressDto.proofOfAddressType,
        step: testBypass ? KYCStep.SUBMITTED : KYCStep.PROOF_OF_ADDRESS_REQUIRED,
        status: testBypass ? KYCStatus.APPROVED : KYCStatus.PENDING,
        ...(testBypass ? { kycLevel: 3, reviewedAt: new Date(), reviewedBy: 'SYSTEM_TEST_BYPASS', rejectionReason: null } : {}),
        updatedAt: new Date(),
      },
    });

    if (testBypass) {
      this.logger.warn(`[TEST BYPASS] KYC Level 3 auto-approved for userId=${userId}`);
    }

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Superadmin: List all pending KYC submissions
   */
  async listPendingKyc(): Promise<
    Array<{
      userId: string
      name: string
      email: string
      submittedAt: string | null
      ninVerifiedAt: string | null
      bvnVerifiedAt: string | null
      nokSubmitted: boolean
    }>
  > {
    const records = await this.prisma.kYC.findMany({
      where: {
        status: KYCStatus.PENDING,
        step: { in: [KYCStep.SUBMITTED, KYCStep.PHOTO_REQUIRED, KYCStep.PROOF_OF_ADDRESS_REQUIRED] },
      },
      orderBy: { submittedAt: 'asc' },
      select: {
        userId: true,
        submittedAt: true,
        ninVerifiedAt: true,
        bvnVerifiedAt: true,
        nextOfKinName: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    return records.map((r) => ({
      userId: r.userId,
      name: r.user ? `${r.user.firstName} ${r.user.lastName}`.trim() : r.userId,
      email: r.user?.email ?? '',
      submittedAt: r.submittedAt?.toISOString() ?? null,
      ninVerifiedAt: r.ninVerifiedAt?.toISOString() ?? null,
      bvnVerifiedAt: r.bvnVerifiedAt?.toISOString() ?? null,
      nokSubmitted: !!r.nextOfKinName,
    }));
  }

  /**
   * User: Resubmit KYC documents after rejection.
   * - Level 0 rejection (initial KYC rejected): resets to NOK_REQUIRED, clears all docs
   * - Level 1 (rejected Level 2 upgrade): clears Level 2 docs, restores to APPROVED Level 1
   * - Level 2 (rejected Level 3 upgrade): clears Level 3 docs, restores to APPROVED Level 2
   */
  async resubmitKyc(userId: string): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found');
    }

    if (kycRecord.status !== KYCStatus.REJECTED) {
      throw new BadRequestException(
        `KYC can only be resubmitted after rejection. Current status: ${kycRecord.status}`,
      );
    }

    // Level 0 → user never completed Level 1, start fresh from NOK
    if (kycRecord.kycLevel === 0) {
      const updatedKyc = await this.prisma.kYC.update({
        where: { userId },
        data: {
          status: KYCStatus.NOT_SUBMITTED,
          step: KYCStep.NOK_REQUIRED,
          nextOfKinName: null,
          nextOfKinRelationship: null,
          nextOfKinPhone: null,
          address: null,
          city: null,
          state: null,
          lga: null,
          country: null,
          selfieUrl: null,
          governmentIdType: null,
          governmentIdFrontUrl: null,
          governmentIdBackUrl: null,
          proofOfAddressType: null,
          proofOfAddressUrl: null,
          submittedAt: null,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
          updatedAt: new Date(),
        },
      });
      return this.mapToResponseDto(updatedKyc);
    }

    // Level 1 rejected Level 2 docs → restore to APPROVED Level 1, clear gov ID docs
    if (kycRecord.kycLevel === 1) {
      const updatedKyc = await this.prisma.kYC.update({
        where: { userId },
        data: {
          status: KYCStatus.APPROVED,
          step: KYCStep.SUBMITTED,
          selfieUrl: null,
          governmentIdType: null,
          governmentIdFrontUrl: null,
          governmentIdBackUrl: null,
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
          updatedAt: new Date(),
        },
      });
      return this.mapToResponseDto(updatedKyc);
    }

    // Level 2 rejected Level 3 docs → restore to APPROVED Level 2, clear proof of address
    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        status: KYCStatus.APPROVED,
        step: KYCStep.SUBMITTED,
        proofOfAddressType: null,
        proofOfAddressUrl: null,
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
        updatedAt: new Date(),
      },
    });
    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Superadmin: Approve KYC.
   * - PHOTO_REQUIRED → Level 2 approved
   * - PROOF_OF_ADDRESS_REQUIRED → Level 3 approved
   * - SUBMITTED (legacy) → Level 1 approved (backwards compat for manual approvals)
   */
  async approveKyc(userId: string, reviewedBy: string): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found');
    }

    const reviewableSteps: KYCStep[] = [
      KYCStep.SUBMITTED,
      KYCStep.PHOTO_REQUIRED,
      KYCStep.PROOF_OF_ADDRESS_REQUIRED,
    ];

    if (!reviewableSteps.includes(kycRecord.step)) {
      throw new BadRequestException(
        `KYC is not awaiting review. Current step: ${kycRecord.step}`,
      );
    }

    if (kycRecord.status !== KYCStatus.PENDING) {
      throw new BadRequestException(
        `KYC is not pending review. Current status: ${kycRecord.status}`,
      );
    }

    // Determine new level based on which tier was reviewed
    let newLevel = kycRecord.kycLevel;
    if (kycRecord.step === KYCStep.PHOTO_REQUIRED) {
      newLevel = 2;
    } else if (kycRecord.step === KYCStep.PROOF_OF_ADDRESS_REQUIRED) {
      newLevel = 3;
    } else if (kycRecord.step === KYCStep.SUBMITTED && kycRecord.kycLevel === 0) {
      // Legacy manual approval of a Level 1 submission
      newLevel = 1;
    }

    const [updatedKyc, user] = await Promise.all([
      this.prisma.kYC.update({
        where: { userId },
        data: {
          status: KYCStatus.APPROVED,
          step: KYCStep.SUBMITTED,
          kycLevel: newLevel,
          reviewedAt: new Date(),
          reviewedBy,
          rejectionReason: null,
          updatedAt: new Date(),
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      }),
    ]);

    await this.authEventsQueue.add(
      AuthJobName.KYC_STATUS_CHANGED,
      {
        userId,
        email: user?.email,
        fullName: user ? `${user.firstName} ${user.lastName}` : '',
        status: 'APPROVED',
        kycLevel: newLevel,
        timestamp: new Date().toISOString(),
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Superadmin: Reject KYC.
   * - PHOTO_REQUIRED/PROOF_OF_ADDRESS_REQUIRED → tier rejection; user retains current kycLevel,
   *   status set to REJECTED so they can resubmit the tier docs.
   * - SUBMITTED (legacy Level 0) → full rejection, user must restart from NOK.
   */
  async rejectKyc(
    userId: string,
    reviewedBy: string,
    rejectionReason: string,
  ): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({ where: { userId } });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found');
    }

    const reviewableSteps: KYCStep[] = [
      KYCStep.SUBMITTED,
      KYCStep.PHOTO_REQUIRED,
      KYCStep.PROOF_OF_ADDRESS_REQUIRED,
    ];

    if (!reviewableSteps.includes(kycRecord.step)) {
      throw new BadRequestException(
        `KYC is not awaiting review. Current step: ${kycRecord.step}`,
      );
    }

    if (kycRecord.status !== KYCStatus.PENDING) {
      throw new BadRequestException(
        `KYC is not pending review. Current status: ${kycRecord.status}`,
      );
    }

    const [updatedKyc, user] = await Promise.all([
      this.prisma.kYC.update({
        where: { userId },
        data: {
          status: KYCStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedBy,
          rejectionReason,
          updatedAt: new Date(),
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      }),
    ]);

    await this.authEventsQueue.add(
      AuthJobName.KYC_STATUS_CHANGED,
      {
        userId,
        email: user?.email,
        fullName: user ? `${user.firstName} ${user.lastName}` : '',
        status: 'REJECTED',
        reason: rejectionReason,
        timestamp: new Date().toISOString(),
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Map KYC entity to response DTO
   */
  private mapToResponseDto(kyc: KYC): KycResponseDto {
    return {
      id: kyc.id,
      userId: kyc.userId,
      status: kyc.status,
      step: kyc.step,
      kycLevel: kyc.kycLevel,

      nextOfKinName: kyc.nextOfKinName ?? undefined,
      nextOfKinRelationship: kyc.nextOfKinRelationship ?? undefined,
      nextOfKinPhone: kyc.nextOfKinPhone ?? undefined,

      address: kyc.address ?? undefined,
      city: kyc.city ?? undefined,
      state: kyc.state ?? undefined,
      lga: kyc.lga ?? undefined,
      country: kyc.country ?? undefined,

      selfieUrl: kyc.selfieUrl ?? undefined,
      governmentIdType: kyc.governmentIdType ?? undefined,
      governmentIdFrontUrl: kyc.governmentIdFrontUrl ?? undefined,
      governmentIdBackUrl: kyc.governmentIdBackUrl ?? undefined,

      proofOfAddressType: kyc.proofOfAddressType ?? undefined,
      proofOfAddressUrl: kyc.proofOfAddressUrl ?? undefined,

      ninVerified: !!kyc.ninVerifiedAt,
      bvnVerified: !!kyc.bvnVerifiedAt,
      nokSubmitted: !!kyc.submittedAt,
      ninVerifiedAt: kyc.ninVerifiedAt ?? undefined,
      bvnVerifiedAt: kyc.bvnVerifiedAt ?? undefined,
      submittedAt: kyc.submittedAt ?? undefined,
      rejectionReason: kyc.rejectionReason ?? null,
      createdAt: kyc.createdAt,
      updatedAt: kyc.updatedAt,
    };
  }
}
