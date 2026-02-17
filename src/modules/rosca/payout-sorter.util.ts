import { PayoutLogic, RoscaMembership, User, UserTrustStats } from '@prisma/client';

// Define a type that includes the necessary relations for sorting
export type MembershipWithTrust = RoscaMembership & {
  user: User & {
    userTrustStats: UserTrustStats | null;
  };
};

export class PayoutSorter {
  /**
   * Sorts memberships based on the circle's payout logic
   */
  static sort(memberships: MembershipWithTrust[], logic: PayoutLogic): MembershipWithTrust[] {
    const members = [...memberships]; // Create a copy to avoid mutating original array

    switch (logic) {
      case PayoutLogic.RANDOM_DRAW:
        return this.sortByRandom(members);

      case PayoutLogic.SEQUENTIAL:
        return this.sortBySequential(members);

      case PayoutLogic.TRUST_SCORE:
        return this.sortByTrustScore(members);

      case PayoutLogic.COMBINED:
      default:
        return this.sortByCombined(members);
    }
  }

  // 1. RANDOM_DRAW: Fisher-Yates Shuffle
  private static sortByRandom(members: MembershipWithTrust[]): MembershipWithTrust[] {
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }
    return members;
  }

  // 2. SEQUENTIAL: Joined Date (Ascending)
  private static sortBySequential(members: MembershipWithTrust[]): MembershipWithTrust[] {
    return members.sort((a, b) => {
      const timeA = a.joinedAt?.getTime() ?? Infinity;
      const timeB = b.joinedAt?.getTime() ?? Infinity;
      return timeA - timeB;
    });
  }

  // 3. TRUST_SCORE: Trust Score (Descending)
  private static sortByTrustScore(members: MembershipWithTrust[]): MembershipWithTrust[] {
    return members.sort((a, b) => {
      const scoreA = a.user.userTrustStats?.trustScore ?? 1;
      const scoreB = b.user.userTrustStats?.trustScore ?? 1;
      return scoreB - scoreA;
    });
  }

  // 4. COMBINED: Trust Score (Desc) then Joined Date (Asc)
  private static sortByCombined(members: MembershipWithTrust[]): MembershipWithTrust[] {
    return members.sort((a, b) => {
      const scoreA = a.user.userTrustStats?.trustScore ?? 1;
      const scoreB = b.user.userTrustStats?.trustScore ?? 1;

      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      const timeA = a.joinedAt?.getTime() ?? Infinity;
      const timeB = b.joinedAt?.getTime() ?? Infinity;
      return timeA - timeB;
    });
  }
}
