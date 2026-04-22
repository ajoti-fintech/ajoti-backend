import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class UserIdThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Prefer authenticated user ID so each user has their own bucket.
    // Fall back to the real client IP (works once trust proxy is set).
    return req?.user?.userId ?? req.ip ?? 'unknown';
  }
}
