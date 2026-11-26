import crypto from 'crypto';

/**
 * Generates an opaque per-centre verification salt (stored on AnganwadiCentre)
 * so offline credential references are keyed HMAC-SHA256 digests rather than
 * predictable un-salted hashes of low-entropy fields.
 */
export function generateCentreSalt(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function computeHmacCredentialRef(params: {
  salt: string;
  name: string;
  yob: string;
  last4?: string;
}): string {
  const normalizedName = params.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const payload = `khorak-offline-v2|${normalizedName}|${params.yob.trim()}|${(params.last4 || '').trim()}`;
  return crypto.createHmac('sha256', params.salt).update(payload).digest('hex');
}

