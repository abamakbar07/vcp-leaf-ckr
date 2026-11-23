import crypto from 'crypto';

export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function isWeakPin(pin: string): boolean {
  if (!isValidPinFormat(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if (/^(\d{2})\1{2}$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true;

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

export function verifyPin(inputPin: string, storedPin: string | null): boolean {
  if (!isValidPinFormat(inputPin)) return false;
  const candidate = Buffer.from(inputPin, 'utf8');
  const expected = Buffer.from(
    storedPin && isValidPinFormat(storedPin) ? storedPin : '000000',
    'utf8'
  );
  const match = crypto.timingSafeEqual(candidate, expected);
  return Boolean(storedPin) && match;
}

export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}