/* eslint-disable prettier/prettier */
import { PrismaService } from '../../prisma';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  async findById(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
}
