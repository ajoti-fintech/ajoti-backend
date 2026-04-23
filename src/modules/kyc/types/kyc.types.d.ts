// Raw response shapes returned by the CheckMyNINBVN API
// (before normalisation in IdentityVerificationService)

export interface CheckNinBvnNinResponse {
  status?: string | boolean;
  message?: string;
  error?: boolean;
  data?: {
    firstname?: string;
    middlename?: string;
    surname?: string;      // NIN uses "surname" for last name
    telephoneno?: string;
    birthdate?: string;    // NIN uses "birthdate"
    gender?: string;
    residence?: unknown;
    photo?: string;
  };
}

export interface CheckNinBvnBvnResponse {
  status?: string | boolean;
  message?: string;
  error?: boolean;
  data?: {
    firstname?: string;
    middlename?: string;
    lastname?: string;   // BVN uses "lastname"
    phone?: string;
    email?: string;
    dob?: string;        // BVN uses "dob"
    gender?: string;
    state?: unknown;
    photo?: string;
  };
}

// Internal contract used by IdentityVerificationService → KycService.
// Field names are normalised (firstName/lastName/dateOfBirth) regardless of provider.

type MatchDetails = {
  firstNameMatch?: boolean;
  lastNameMatch?: boolean;
  dobMatch?: boolean;
};

export type VerificationResult = {
  success: boolean;
  verified: boolean;
  message: string;
  data: {
    firstName?: string;
    lastName?: string;
    middleName?: string;
    dateOfBirth?: string;
    phone?: string;
    email?: string;
    gender?: string;
    photo?: string;
    [key: string]: unknown;
  } | null;
  matchDetails: MatchDetails;
};
