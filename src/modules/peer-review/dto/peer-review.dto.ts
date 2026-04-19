// src/modules/peer-review/dto/peer-review.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class SubmitReviewDto {
  @ApiProperty({ description: 'User ID of the person being reviewed' })
  @IsUUID()
  revieweeId!: string;

  @ApiProperty({ description: 'Rating from 1 (poor) to 5 (excellent)', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ description: 'Optional comment (max 280 characters)', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  comment?: string;
}

// ── Response DTOs ───────────────────────────────

export class ReviewItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() reviewerId!: string;
  @ApiProperty() reviewerName!: string;
  @ApiProperty() revieweeId!: string;
  @ApiProperty() revieweeName!: string;
  @ApiProperty() rating!: number;
  @ApiPropertyOptional({ nullable: true }) comment!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class ReviewSummaryItemDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() averageRating!: number;
  @ApiProperty() totalReviews!: number;
}
