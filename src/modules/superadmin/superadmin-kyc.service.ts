import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { KycQueueFilterDto } from './dto/superadmin.dto';
import { KYCStatus } from '@prisma/client';

@Injectable()
export class SuperadminKycService {
  constructor(private readonly prisma: PrismaService) {}

  async listKycQueue(dto: KycQueueFilterDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;
    const status = dto.status ?? KYCStatus.PENDING;

    const [records, total] = await Promise.all([
      this.prisma.kYC.findMany({
        where: { status },
        skip,
        take: limit,
        orderBy: { updatedAt: 'asc' }, // oldest first so nothing ages out
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.kYC.count({ where: { status } }),
    ]);

    return {
      data: records,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getKycDetail(userId: string) {
    const kyc = await this.prisma.kYC.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            gender: true,
            dob: true,
            isVerified: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!kyc) throw new NotFoundException('KYC record not found for this user');
    return kyc;
  }
}
