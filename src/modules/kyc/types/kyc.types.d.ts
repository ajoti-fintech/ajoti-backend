export interface YouverifyResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data?: any;
}

type MatchDetails = {
  firstNameMatch?: boolean;
  lastNameMatch?: boolean;
  dobMatch?: boolean;
  phoneNumberMatch?: boolean;
};

export type VerificationResult = {
  success: boolean;
  verified: boolean;
  message: string;
  data: any;
  matchDetails: MatchDetails; // ✅ not optional
};
