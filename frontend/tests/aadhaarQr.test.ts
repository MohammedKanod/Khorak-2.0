// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  computeCredentialHash,
  parseAadhaarOfflineQr,
  SYNTHETIC_DEMO_QR_SAMPLES,
} from '../src/lib/aadhaarQr';

describe('Aadhaar Offline XML QR local parser (zero Aadhaar exposure)', () => {
  it('parses OfflinePaperlessKyc XML locally without exposing raw or last-4 Aadhaar digits', async () => {
    const sample = SYNTHETIC_DEMO_QR_SAMPLES[0];
    const salt = 'centre-salt-vavdi-01';
    const parsed = await parseAadhaarOfflineQr(sample.xmlPayload, salt);

    expect(parsed.name).toBe('Poojaben Maheshbhai Bariya');
    expect(parsed.yob).toBe('1997');
    expect(parsed.isSyntheticDemo).toBe(true);
    expect(parsed.protectedCredentialReference).toMatch(/^[a-f0-9]{64}$/);

    // Strictly verify ZERO last-4 Aadhaar digits or maskedIdLast4 fields exist
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('4821');
    expect(serialized).not.toContain('maskedIdLast4');
    expect((parsed as unknown as Record<string, unknown>).maskedIdLast4).toBeUndefined();

    const expectedHash = await computeCredentialHash(
      '4821',
      'Poojaben Maheshbhai Bariya',
      '1997',
      salt
    );
    expect(parsed.protectedCredentialReference).toBe(expectedHash);
  });

  it('parses PrintLetterBarcodeData XML locally and isolates hashes per centre salt', async () => {
    const sample = SYNTHETIC_DEMO_QR_SAMPLES[1];
    const parsedA = await parseAadhaarOfflineQr(sample.xmlPayload, 'salt-centre-a');
    const parsedB = await parseAadhaarOfflineQr(sample.xmlPayload, 'salt-centre-b');

    expect(parsedA.name).toBe('Aarav Sureshbhai Parmar');
    expect(parsedA.yob).toBe('2024');
    expect(parsedA.protectedCredentialReference).not.toBe(parsedB.protectedCredentialReference);
    expect(JSON.stringify(parsedA)).not.toContain('7394');
  });

  it('rejects non-XML or malformed QR payloads cleanly', async () => {
    await expect(parseAadhaarOfflineQr('123456789012')).rejects.toThrow();
    await expect(parseAadhaarOfflineQr('<InvalidNode/>')).rejects.toThrow();
  });
});
