// src/common/encryption/field-encryption.service.ts
//
// AES-256-GCM authenticated encryption for sensitive database fields.
//
// Encrypted format: enc:v1:<iv_hex>:<authtag_hex>:<ciphertext_hex>
// The "enc:v1:" prefix lets us detect whether a stored value is already
// encrypted or is legacy plaintext, making gradual migrations safe.
//
// Required env var:
//   KYC_ENCRYPTION_KEY — 64 hex chars (32 bytes).
//   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV recommended for GCM
const TAG_BYTES = 16;  // 128-bit auth tag

@Injectable()
export class FieldEncryptionService implements OnModuleInit {
  private readonly logger = new Logger(FieldEncryptionService.name);
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const hex = this.config.get<string>('KYC_ENCRYPTION_KEY');
    if (!hex || hex.length !== 64) {
      throw new Error(
        'KYC_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    this.key = Buffer.from(hex, 'hex');
    this.logger.log('Field encryption key loaded');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) {
      // Legacy plaintext — return as-is so callers can re-encrypt
      return value;
    }

    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted field value');
    }

    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ctHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Returns true if the value has already been encrypted by this service. */
  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }
}
