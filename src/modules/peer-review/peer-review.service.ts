// src/modules/peer-review/peer-review.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CircleStatus, MembershipStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';
import { SubmitReviewDto } from './dto/peer-review.dto';

@Injectable()
export class PeerReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trustService: TrustService,
  ) {}

  // ── Submit a peer review ─────────────────────────────────────────────────

  async submitReview(circleId: string, reviewerId: string, dto: SubmitReviewDto) {
    const { revieweeId, rating, comment } = dto;

    if (reviewerId === revieweeId) {
      throw new BadRequestException('You cannot review yourself');
    }

    return this.prisma.$transaction(async (tx) => {
      // Load circle
      const circle = await tx.roscaCircle.findUnique({
        where: { id: circleId },
        select: { id: true, status: true, adminId: true },
      });
      if (!circle) throw new NotFoundException('Circle not found');
      if (circle.status !== CircleStatus.COMPLETED) {
        throw new BadRequestException('Peer reviews can only be submitted after the circle has completed');
      }

      // Collect all participant IDs: admin + all ACTIVE/COMPLETED members
      const memberships = await tx.roscaMembership.findMany({
        where: {
          circleId,
          status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] },
        },
        select: { userId: true },
      });
      const memberIds = new Set(memberships.map((m) => m.userId));
      const participantIds = new Set([...memberIds, circle.adminId]);

      // Reviewer must be a participant
      if (!participantIds.has(reviewerId)) {
        throw new ForbiddenException('You are not a participant of this circle');
      }

      // Reviewee must be a participant
      if (!participantIds.has(revieweeId)) {
        throw new NotFoundException('The person you are reviewing was not part of this circle');
      }

      // Duplicate check (before hitting DB unique constraint for a clean error)
      const existing = await tx.peerReview.findUnique({
        where: { circleId_reviewerId_revieweeId: { circleId, reviewerId, revieweeId } },
      });
      if (existing) {
        throw new ConflictException('You have already submitted a review for this person in this circle');
      }

      // Create the review
      const review = await tx.peerReview.create({
        data: { circleId, reviewerId, revieweeId, rating, comment },
        include: {
          reviewer: { select: { firstName: true, lastName: true } },
          reviewee: { select: { firstName: true, lastName: true } },
        },
      });

      // Update trust score only for members (not for the admin)
      if (memberIds.has(revieweeId)) {
        await this.trustService.updateTrustScore(
          revieweeId,
          { type: 'peer_rating', rating },
          tx,
        );
      }

      return {
        id: review.id,
        reviewerId: review.reviewerId,
        reviewerName: `${review.reviewer.firstName} ${review.reviewer.lastName}`,
        revieweeId: review.revieweeId,
        revieweeName: `${review.reviewee.firstName} ${review.reviewee.lastName}`,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      };
    });
  }

  // ── List reviews (admin sees reviews about members; super admin sees all) ─

  async getReviews(circleId: string, requesterId: string, requesterRole: Role) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: { adminId: true, status: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');

    if (requesterRole === Role.SUPERADMIN) {
      // Super admin: all reviews
      return this.fetchReviews(circleId, undefined);
    }

    if (requesterRole === Role.ADMIN) {
      // Circle admin only
      if (circle.adminId !== requesterId) {
        throw new ForbiddenException('Only the circle admin can view reviews');
      }

      // Collect member IDs (exclude admin from reviewees)
      const memberships = await this.prisma.roscaMembership.findMany({
        where: {
          circleId,
          status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] },
        },
        select: { userId: true },
      });
      const memberIds = memberships.map((m) => m.userId);
      return this.fetchReviews(circleId, memberIds);
    }

    throw new ForbiddenException('Members cannot view reviews');
  }

  // ── Review summary per reviewee (admin + super admin) ───────────────────

  async getReviewSummary(circleId: string, requesterId: string, requesterRole: Role) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: { adminId: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');

    if (requesterRole === Role.MEMBER) {
      throw new ForbiddenException('Members cannot view review summaries');
    }

    if (requesterRole === Role.ADMIN && circle.adminId !== requesterId) {
      throw new ForbiddenException('Only the circle admin can view the review summary');
    }

    // For admin: only member reviewees. For super admin: all reviewees.
    let revieweeFilter: string[] | undefined;
    if (requesterRole === Role.ADMIN) {
      const memberships = await this.prisma.roscaMembership.findMany({
        where: {
          circleId,
          status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] },
        },
        select: { userId: true },
      });
      revieweeFilter = memberships.map((m) => m.userId);
    }

    const reviews = await this.prisma.peerReview.findMany({
      where: {
        circleId,
        ...(revieweeFilter ? { revieweeId: { in: revieweeFilter } } : {}),
      },
      include: {
        reviewee: { select: { firstName: true, lastName: true } },
      },
    });

    // Group by reviewee
    const map = new Map<string, { name: string; total: number; sum: number }>();
    for (const r of reviews) {
      const key = r.revieweeId;
      if (!map.has(key)) {
        map.set(key, {
          name: `${r.reviewee.firstName} ${r.reviewee.lastName}`,
          total: 0,
          sum: 0,
        });
      }
      const entry = map.get(key)!;
      entry.total += 1;
      entry.sum += r.rating;
    }

    return Array.from(map.entries()).map(([userId, { name, total, sum }]) => ({
      userId,
      name,
      averageRating: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
      totalReviews: total,
    }));
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async fetchReviews(circleId: string, revieweeIds?: string[]) {
    const reviews = await this.prisma.peerReview.findMany({
      where: {
        circleId,
        ...(revieweeIds ? { revieweeId: { in: revieweeIds } } : {}),
      },
      include: {
        reviewer: { select: { firstName: true, lastName: true } },
        reviewee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reviews.map((r) => ({
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerName: `${r.reviewer.firstName} ${r.reviewer.lastName}`,
      revieweeId: r.revieweeId,
      revieweeName: `${r.reviewee.firstName} ${r.reviewee.lastName}`,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    }));
  }
}
