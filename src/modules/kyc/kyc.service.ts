import {
  BadRequestException,
  Injectable,
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
// import { KafkaService } from '../kafka/kafka.service';
import * as path from 'path';

type PhotoFiles = {
  selfie: Express.Multer.File;
  front: Express.Multer.File;
  back?: Express.Multer.File;
};

@Injectable()
export class KycService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly identityService: IdentityVerificationService,
    // private readonly kafkaService: KafkaService,
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
          nin,
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
          bvn,
          bvnVerifiedAt: new Date(),
          step: KYCStep.NOK_REQUIRED,
          status: KYCStatus.PENDING,
          updatedAt: new Date(),
        },
      });
    });

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

    // Update KYC record
    const updatedKyc = await this.prisma.kYC.update({
      where: { userId },
      data: {
        nextOfKinName,
        nextOfKinRelationship,
        nextOfKinPhone,
        step: KYCStep.SUBMITTED,
        status: KYCStatus.PENDING, // Changed to PENDING for review
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });

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

    // TODO: Replace with BullMQ later
    console.warn(`[KycService] KYC Approved - Event would have been emitted to Kafka:`, {
      userId,
      email: user?.email,
      fullName: `${user?.firstName} ${user?.lastName}`,
      status: 'APPROVED',
      timestamp: new Date().toISOString(),
    });
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

    // TODO: Replace with BullMQ later
    console.warn(`[KycService] KYC Approved - Event would have been emitted to Kafka:`, {
      userId,
      email: user?.email,
      fullName: `${user?.firstName} ${user?.lastName}`,
      status: 'REJECTED',
      reason: rejectionReason,
      timestamp: new Date().toISOString(),
    });

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

      nin: kyc.nin ?? undefined,
      bvn: kyc.bvn ?? undefined,

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
      createdAt: kyc.createdAt,
      updatedAt: kyc.updatedAt,
    };
  }
}
