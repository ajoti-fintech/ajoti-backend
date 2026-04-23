import { Injectable, Logger } from '@nestjs/common';

export type CreditEventType = 'missed_payment' | 'loan_default' | 'positive_payment';
export type CreditEventSeverity = 'low' | 'medium' | 'high';

export interface ExternalCreditEvent {
  userId: string;
  type: CreditEventType;
  severity: CreditEventSeverity;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Placeholder for an external credit bureau integration.
 * All HTTP calls are simulated — replace with real provider SDK/HTTP client when available.
 * Retry logic mirrors the pattern used by the rest of the platform.
 */
@Injectable()
export class ExternalCreditService {
  private readonly logger = new Logger(ExternalCreditService.name);

  /**
   * Fetch a credit score (300–850) for a user from the external bureau.
   * Returns null on total failure — callers must handle the fallback.
   */
  async getExternalCreditScore(userId: string): Promise<number | null> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const score = await this.simulateBureauScoreFetch(userId);
        this.logger.log(`External credit score fetched for userId=${userId}: ${score}`);
        return score;
      } catch (err) {
        const isLast = attempt === RETRY_ATTEMPTS;
        this.logger.warn(
          `External credit score fetch attempt ${attempt}/${RETRY_ATTEMPTS} failed for userId=${userId}`,
          isLast ? err : undefined,
        );
        if (!isLast) {
          await this.delay(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
        }
      }
    }

    this.logger.error(`External credit score unavailable for userId=${userId} — using fallback`);
    return null;
  }

  /**
   * Report a credit event to the external bureau.
   * Failures are logged but never rethrow — reporting must not block business operations.
   */
  async reportCreditEvent(event: ExternalCreditEvent): Promise<void> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        await this.simulateBureauEventReport(event);
        this.logger.log(
          `Credit event reported: type=${event.type}, severity=${event.severity}, userId=${event.userId}`,
        );
        return;
      } catch (err) {
        const isLast = attempt === RETRY_ATTEMPTS;
        this.logger.warn(
          `Credit event report attempt ${attempt}/${RETRY_ATTEMPTS} failed for userId=${event.userId}`,
          isLast ? err : undefined,
        );
        if (!isLast) {
          await this.delay(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
        }
      }
    }

    // Swallow — bureau reporting must never block the calling operation.
    this.logger.error(
      `Failed to report credit event type=${event.type} for userId=${event.userId} after ${RETRY_ATTEMPTS} attempts`,
    );
  }

  // ── Simulated HTTP calls ────────────────────────────────────────────────────
  // Replace these with real HTTP client calls (e.g. axios/fetch) when integrating.

  private async simulateBureauScoreFetch(userId: string): Promise<number> {
    await this.delay(50); // simulate network latency

    // Deterministic mock: derive a stable score from the userId string
    // so the same user always gets the same simulated score.
    const hash = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const score = 550 + (hash % 250); // range: 550–799
    return Math.min(850, Math.max(300, score));
  }

  private async simulateBureauEventReport(event: ExternalCreditEvent): Promise<void> {
    await this.delay(30); // simulate network latency
    // In production: POST to bureau API with event payload
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
