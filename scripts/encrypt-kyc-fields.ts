/**
 * One-time migration: encrypt plaintext NIN/BVN values in the KYC table.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register scripts/encrypt-kyc-fields.ts
 *
 * Safe to re-run — already-encrypted values (starting with "enc:v1:") are skipped.
 *
 * Requires KYC_ENCRYPTION_KEY in your .env (64 hex chars / 32 bytes).
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function loadKey(): Buffer {
  const hex = process.env.KYC_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'KYC_ENCRYPTION_KEY must be a 64-character hex string.\n' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function makePrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is missing from .env');
  const pool = new Pool({ connectionString });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

async function main() {
  const key = loadKey();
  const prisma = makePrisma();

  try {
    // Fetch all KYC records that have a NIN or BVN set
    const records = await prisma.kYC.findMany({
      where: {
        OR: [
          { nin: { not: null } },
          { bvn: { not: null } },
        ],
      },
      select: { id: true, nin: true, bvn: true },
    });

    console.log(`Found ${records.length} KYC record(s) with NIN/BVN set.`);

    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      const patch: { nin?: string; bvn?: string } = {};

      if (record.nin && !record.nin.startsWith(PREFIX)) {
        patch.nin = encrypt(record.nin, key);
      }
      if (record.bvn && !record.bvn.startsWith(PREFIX)) {
        patch.bvn = encrypt(record.bvn, key);
      }

      if (Object.keys(patch).length === 0) {
        console.log(`  [SKIP] ${record.id} — already encrypted`);
        skipped++;
        continue;
      }

      await prisma.kYC.update({ where: { id: record.id }, data: patch });

      const fields = Object.keys(patch).join(', ');
      console.log(`  [OK]   ${record.id} — encrypted: ${fields}`);
      updated++;
    }

    console.log(`\nDone. ${updated} record(s) encrypted, ${skipped} skipped.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
