import crypto from 'crypto';
import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

// Precomputed dummy hash for constant-time rejection when User ID does not exist
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHR2YWx1ZTEyMw$8x9Z+4q3k7L1m2N5p8R0t2V4x6Z8b0D2f4H6j8L0n2P';

export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function isWeakPin(pin: string): boolean {
  if (!isValidPinFormat(pin)) return true;
  // Reject all identical digits (e.g., 000000, 111111)
  if (/^(\d)\1{5}$/.test(pin)) return true;
  // Reject repeated 2-digit or 3-digit patterns (e.g., 121212, 123123)
  if (/^(\d{2})\1{2}$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true;
  // Reject strict ascending or descending sequences (e.g., 123456, 654321)
  const digits = pin.split('').map(Number);
  let asc = true;
  let desc = true;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== digits[i - 1] + 1) asc = false;
    if (digits[i] !== digits[i - 1] - 1) desc = false;
  }
  return asc || desc;
}

export function generateSecurePin(excludeSet?: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    const raw = crypto.randomInt(0, 1_000_000);
    const pin = String(raw).padStart(6, '0');
    if (isWeakPin(pin)) continue;
    if (excludeSet?.has(pin)) continue;
    return pin;
  }
  throw new Error('Failed to generate unique non-predictable 6-digit PIN');
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error('PIN must be exactly 6 numeric digits');
  }
  return hash(pin, ARGON2_OPTIONS);
}

export async function verifyPin(pin: string, storedHash: string | null): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  try {
    return await verify(storedHash || DUMMY_HASH, pin);
  } catch {
    return false;
  }
}

export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}