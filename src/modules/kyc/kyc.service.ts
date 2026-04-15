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
    const rel = path.relative(process.cwd(), file.path).split(path.sep).join('/'); // Normalize to forward slashes
    return `/${rel}`;
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

    return this.mapToResponseDto(kyc);
  }

  /**
   * Verify NIN and update KYC record
   */
  async verifyNin(userId: string, verifyNinDto: VerifyNinDto): Promise<KycResponseDto> {
    const { nin, firstName, lastName, dob } = verifyNinDto;

    // Get or create KYC record
    let kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      kycRecord = await this.initializeKyc(userId);
    }

    // Validate KYC step
    if (kycRecord.step !== KYCStep.NIN_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.NIN_REQUIRED}`,
      );
    }

    // Check if already verified
    if (kycRecord.ninVerifiedAt) {
      throw new BadRequestException('NIN already verified');
    }

    // Verify NIN with identity service
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

    // Update KYC record with transaction
    const updatedKyc = await this.prisma.$transaction(async (tx) => {
      // Verify user exists
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Update KYC record
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

    // Get KYC record
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please verify NIN first.');
    }

    // Validate KYC step
    if (kycRecord.step !== KYCStep.BVN_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.BVN_REQUIRED}`,
      );
    }

    // Check if already verified
    if (kycRecord.bvnVerifiedAt) {
      throw new BadRequestException('BVN already verified');
    }

    // Verify BVN with identity service
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

    // Update KYC record with transaction
    const updatedKyc = await this.prisma.$transaction(async (tx) => {
      // Verify user exists
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Update KYC record
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

    // Internal sync: if user already has a static VA, update BVN at provider.
    // This is best-effort and does not block KYC completion.
    await this.virtualAccountService.syncBvnFromKyc(userId, bvn);

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit Next of Kin information and complete KYC
   */
  async submitNextOfKin(userId: string, verifyNokDto: VerifyNokDto): Promise<KycResponseDto> {
    const { nextOfKinName, nextOfKinRelationship, nextOfKinPhone } = verifyNokDto;

    // Get KYC record
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    // Validate KYC step
    if (kycRecord.step !== KYCStep.NOK_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.NOK_REQUIRED}`,
      );
    }

    // Check if already submitted
    if (kycRecord.submittedAt) {
      throw new BadRequestException('KYC already submitted');
    }

    // In non-production, auto-approve when the magic test NIN was used
    const isTestBypass =
      process.env.NODE_ENV !== 'production' &&
      !!kycRecord.nin &&
      this.fieldEncryption.decrypt(kycRecord.nin) === '00000000000';

    // Update KYC record
    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        nextOfKinName,
        nextOfKinRelationship,
        nextOfKinPhone,
        step: KYCStep.SUBMITTED,
        status: isTestBypass ? KYCStatus.APPROVED : KYCStatus.PENDING,
        submittedAt: new Date(),
        ...(isTestBypass ? { reviewedAt: new Date(), reviewedBy: 'SYSTEM_TEST_BYPASS' } : {}),
        updatedAt: new Date(),
      },
    });

    if (isTestBypass) {
      this.logger.warn(`[TEST BYPASS] KYC auto-approved for userId=${userId}`);
    }

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit Address information for verification
   */
  async submitAddress(userId: string, verifyAddressDto: VerifyAddressDto): Promise<KycResponseDto> {
    const { address, city, state, lga, country } = verifyAddressDto;

    // Get KYC record
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    // Validate KYC step
    if (kycRecord.step !== KYCStep.ADDRESS_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.ADDRESS_REQUIRED}`,
      );
    }

    // Update KYC record
    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        address,
        city,
        state,
        lga,
        country,
        step: KYCStep.SUBMITTED,
        status: KYCStatus.PENDING, // Changed to PENDING for review
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit Photo for verification
   */
  async submitPhoto(
    userId: string,
    verifyPhotoDto: VerifyPhotoDto,
    files: PhotoFiles,
  ): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    if (kycRecord.step !== KYCStep.PHOTO_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.PHOTO_REQUIRED}`,
      );
    }

    const { selfie, front, back } = files;
    const selfieUrl = this.fileToPublicUrl(selfie);
    const frontUrl = this.fileToPublicUrl(front);
    const backUrl = back ? this.fileToPublicUrl(back) : null;

    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        selfieUrl,
        governmentIdType: verifyPhotoDto.governmentIdType,
        governmentIdFrontUrl: frontUrl,
        governmentIdBackUrl: backUrl,
        selfieUploadedAt: new Date(),
        governmentIdUploadedAt: new Date(),
        step: KYCStep.PROOF_OF_ADDRESS_REQUIRED,
        status: KYCStatus.PENDING,
        updatedAt: new Date(),
      },
    });

    return this.mapToResponseDto(updatedKyc);
  }

  /**
   * Submit Proof of Address for verification
   */
  async submitProofOfAddress(
    userId: string,
    verifyProofOfAddressDto: VerifyProofOfAddressDto,
    file: Express.Multer.File,
  ): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found. Please complete previous steps first.');
    }

    if (kycRecord.step !== KYCStep.PROOF_OF_ADDRESS_REQUIRED) {
      throw new BadRequestException(
        `Invalid KYC step. Current step: ${kycRecord.step}. Expected: ${KYCStep.PROOF_OF_ADDRESS_REQUIRED}`,
      );
    }

    const proofOfAddressUrl = this.fileToPublicUrl(file);

    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        proofOfAddressUrl,
        proofOfAddressType: verifyProofOfAddressDto.proofOfAddressType,
        updatedAt: new Date(),
      },
    });

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
      where: { status: KYCStatus.PENDING, step: KYCStep.SUBMITTED },
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
   * User: Resubmit KYC after rejection — resets step to NOK_REQUIRED so the
   * user can update their NOK, address, photos and proof of address.
   * NIN and BVN remain verified; only the post-identity steps are cleared.
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

    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        status: KYCStatus.NOT_SUBMITTED,
        step: KYCStep.NOK_REQUIRED,
        // Clear prior submission data so user re-enters it
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

  /**
   * Admin: Approve KYC
   */
  async approveKyc(userId: string, reviewedBy: string): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found');
    }

    if (kycRecord.step !== KYCStep.SUBMITTED) {
      throw new BadRequestException('KYC must be submitted before approval');
    }

    const [updatedKyc, user] = await Promise.all([
      this.prisma.kYC.update({
        where: { userId },
        data: {
          status: KYCStatus.APPROVED,
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
   * Admin: Reject KYC
   */
  async rejectKyc(
    userId: string,
    reviewedBy: string,
    rejectionReason: string,
  ): Promise<KycResponseDto> {
    const kycRecord = await this.prisma.kYC.findUnique({
      where: { userId },
    });

    if (!kycRecord) {
      throw new NotFoundException('KYC record not found');
    }

    if (kycRecord.step !== KYCStep.SUBMITTED) {
      throw new BadRequestException('KYC must be submitted before rejection');
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

      // NIN/BVN are encrypted at rest and never exposed in API responses.
      // Presence is indicated by ninVerifiedAt / bvnVerifiedAt instead.

      nextOfKinName: kyc.nextOfKinName ?? undefined,
      nextOfKinRelationship: kyc.nextOfKinRelationship ?? undefined,
      nextOfKinPhone: kyc.nextOfKinPhone ?? undefined,

      // Address
      address: kyc.address ?? undefined,
      city: kyc.city ?? undefined,
      state: kyc.state ?? undefined,
      lga: kyc.lga ?? undefined,
      country: kyc.country ?? undefined,

      // Photo / ID
      selfieUrl: kyc.selfieUrl ?? undefined,
      governmentIdType: kyc.governmentIdType ?? undefined,
      governmentIdFrontUrl: kyc.governmentIdFrontUrl ?? undefined,
      governmentIdBackUrl: kyc.governmentIdBackUrl ?? undefined,

      // Proof of address
      proofOfAddressType: kyc.proofOfAddressType ?? undefined,
      proofOfAddressUrl: kyc.proofOfAddressUrl ?? undefined,

      ninVerifiedAt: kyc.ninVerifiedAt ?? undefined,
      bvnVerifiedAt: kyc.bvnVerifiedAt ?? undefined,
      submittedAt: kyc.submittedAt ?? undefined,
      rejectionReason: kyc.rejectionReason ?? null,
      createdAt: kyc.createdAt,
      updatedAt: kyc.updatedAt,
    };
  }
}
