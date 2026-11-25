import { describe, it, expect } from 'vitest';
import {
  computeCredentialHash,
  parseAadhaarOfflineQr,
  SYNTHETIC_DEMO_QR_SAMPLES,
} from '../src/lib/aadhaarQr';

describe('Aadhaar Offline XML QR local parser', () => {
  it('parses OfflinePaperlessKyc XML locally without retaining raw XML', async () => {
    const sample = SYNTHETIC_DEMO_QR_SAMPLES[0];
    const parsed = await parseAadhaarOfflineQr(sample.xmlPayload);

    expect(parsed.name).toBe('Poojaben Maheshbhai Bariya');
    expect(parsed.yob).toBe('1997');
    expect(parsed.maskedIdLast4).toBe('4821');
    expect(parsed.isSyntheticDemo).toBe(true);

    const expectedHash = await computeCredentialHash('4821', 'Poojaben Maheshbhai Bariya', '1997');
    expect(parsed.protectedCredentialReference).toBe(expectedHash);
  });

  it('parses PrintLetterBarcodeData XML locally', async () => {
    const sample = SYNTHETIC_DEMO_QR_SAMPLES[1];
    const parsed = await parseAadhaarOfflineQr(sample.xmlPayload);

    expect(parsed.name).toBe('Aarav Sureshbhai Parmar');
    expect(parsed.yob).toBe('2024');
    expect(parsed.maskedIdLast4).toBe('7394');
  });

  it('rejects non-XML or malformed QR payloads cleanly', async () => {
    await expect(parseAadhaarOfflineQr('123456789012')).rejects.toThrow();
    await expect(parseAadhaarOfflineQr('<InvalidNode/>')).rejects.toThrow();
  });
});

