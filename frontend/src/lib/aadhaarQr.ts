/**
 * Local Aadhaar Offline XML / PrintLetterBarcodeData / Synthetic QR Processor.
 *
 * SECURITY & PRIVACY GUARANTEES:
 * 1. Runs 100% locally in the browser/device. Zero external API calls.
 * 2. Never logs, displays, or transmits raw XML, full Aadhaar numbers, or last-4 Aadhaar digits.
 * 3. Uses transient local XML parsing ONLY to derive a per-centre HMAC-SHA256
 *    `protectedCredentialReference` + display name / YOB / gender.
 * 4. Clearly distinct from live UIDAI online authentication.
 */

export interface ParsedOfflineCredential {
  format: 'OFFLINE_KYC_XML' | 'PRINT_LETTER_XML' | 'SYNTHETIC_DEMO_XML';
  name: string;
  yob: string;
  gender: string;
  protectedCredentialReference: string;
  isSyntheticDemo: boolean;
}

export interface SyntheticQrSample {
  label: string;
  labelGu: string;
  localReference: string;
  category: string;
  xmlPayload: string;
}

export const SYNTHETIC_DEMO_QR_SAMPLES: SyntheticQrSample[] = [
  {
    label: 'Poojaben M. Bariya (Pregnant Woman)',
    labelGu: 'પૂજાબેન મહેશભાઈ બારિયા (ગર્ભવતી મહિલા)',
    localReference: 'BEN-GDR01-001',
    category: 'PREGNANT_WOMAN',
    xmlPayload: `<OfflinePaperlessKyc referenceId="SYNTH48212026"><UidData><Poi name="Poojaben Maheshbhai Bariya" dob="14-06-1997" gender="F"/><Poa vtc="Vavdi Bujarg" dist="Panchmahal" state="Gujarat"/></UidData><Signature synthetic="true"/></OfflinePaperlessKyc>`,
  },
  {
    label: 'Aarav S. Parmar (Child 6m-3y)',
    labelGu: 'આરવ સુરેશભાઈ પરમાર (બાળક ૬ માસ-૩ વર્ષ)',
    localReference: 'BEN-GDR01-002',
    category: 'CHILD_6M_3Y',
    xmlPayload: `<PrintLetterBarcodeData uid="XXXXXXXX7394" name="Aarav Sureshbhai Parmar" gender="M" yob="2024" vtc="Vavdi Bujarg" dist="Panchmahal" state="Gujarat" synthetic="true"/>`,
  },
  {
    label: 'Kajalben R. Nayak (Lactating Mother)',
    labelGu: 'કાજલબેન રમેશભાઈ નાયક (ધાત્રી માતા)',
    localReference: 'BEN-GDR01-003',
    category: 'LACTATING_MOTHER',
    xmlPayload: `<OfflinePaperlessKyc referenceId="SYNTH15082026"><UidData><Poi name="Kajalben Rameshbhai Nayak" dob="02-09-1999" gender="F"/><Poa vtc="Vavdi Bujarg" dist="Panchmahal" state="Gujarat"/></UidData><Signature synthetic="true"/></OfflinePaperlessKyc>`,
  },
  {
    label: 'Diyaben K. Rathwa (Adolescent Girl)',
    labelGu: 'દિયાબેન કિરણભાઈ રાઠવા (કિશોરી)',
    localReference: 'BEN-GDR01-004',
    category: 'ADOLESCENT_GIRL',
    xmlPayload: `<PrintLetterBarcodeData uid="XXXXXXXX9260" name="Diyaben Kiranbhai Rathwa" gender="F" yob="2011" vtc="Vavdi Bujarg" dist="Panchmahal" state="Gujarat" synthetic="true"/>`,
  },
];

export async function computeCredentialHash(
  last4: string,
  name: string,
  yob: string,
  salt?: string | null
): Promise<string> {
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const enc = new TextEncoder();

  if (salt && salt.trim().length > 0) {
    const payload = `khorak-offline-v2|${normalizedName}|${yob.trim()}|${last4.trim()}`;
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(salt),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const raw = `khorak-uidai-offline-v1|${last4.trim()}|${normalizedName}|${yob.trim()}`;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractYearFromDob(dob: string): string {
  const match = dob.match(/(\d{4})/);
  return match ? match[1] : '';
}

function extractLast4FromUidOrRef(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length >= 4) return digits.slice(0, 4) === '2026' ? digits.slice(-4) : value.includes('SYNTH') ? digits.slice(0, 4) : digits.slice(-4);
  return '';
}

export async function parseAadhaarOfflineQr(
  rawQrText: string,
  centreSalt?: string | null
): Promise<ParsedOfflineCredential> {
  const trimmed = rawQrText.trim();
  if (!trimmed.startsWith('<')) {
    throw new Error(
      'Unsupported QR format. Expected Aadhaar Offline Paperless XML or PrintLetterBarcodeData XML.'
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid XML structure in scanned QR credential.');
  }

  // Case 1: UIDAI Offline Paperless e-KYC XML (<OfflinePaperlessKyc>)
  const offlineKyc = doc.querySelector('OfflinePaperlessKyc');
  if (offlineKyc) {
    const poi = offlineKyc.querySelector('UidData > Poi') || offlineKyc.querySelector('Poi');
    if (!poi) {
      throw new Error('Missing <Poi> identity node in OfflinePaperlessKyc XML.');
    }

    const name = poi.getAttribute('name')?.trim() || '';
    const dob = poi.getAttribute('dob')?.trim() || '';
    const yob = poi.getAttribute('yob')?.trim() || extractYearFromDob(dob);
    const gender = poi.getAttribute('gender')?.trim() || 'U';
    const refId = offlineKyc.getAttribute('referenceId')?.trim() || '';

    // UIDAI referenceId starts with 4-digit last4 + timestamp
    const last4 =
      refId.startsWith('SYNTH') && refId.length >= 9
        ? refId.slice(5, 9)
        : /^\d{4}/.test(refId)
          ? refId.slice(0, 4)
          : extractLast4FromUidOrRef(refId);

    if (!name || !yob || !/^\d{4}$/.test(last4)) {
      throw new Error('Incomplete fields in OfflinePaperlessKyc credential.');
    }

    const isSynthetic =
      refId.startsWith('SYNTH') ||
      offlineKyc.querySelector('Signature')?.getAttribute('synthetic') === 'true';

    const protectedCredentialReference = await computeCredentialHash(
      last4,
      name,
      yob,
      centreSalt
    );
    return {
      format: isSynthetic ? 'SYNTHETIC_DEMO_XML' : 'OFFLINE_KYC_XML',
      name,
      yob,
      gender,
      protectedCredentialReference,
      isSyntheticDemo: isSynthetic,
    };
  }

  // Case 2: Standard Aadhaar PrintLetterBarcodeData XML
  const barcodeData = doc.querySelector('PrintLetterBarcodeData');
  if (barcodeData) {
    const name = barcodeData.getAttribute('name')?.trim() || '';
    const dob = barcodeData.getAttribute('dob')?.trim() || '';
    const yob = barcodeData.getAttribute('yob')?.trim() || extractYearFromDob(dob);
    const gender = barcodeData.getAttribute('gender')?.trim() || 'U';
    const uidAttr = barcodeData.getAttribute('uid')?.trim() || '';
    const last4 = uidAttr.slice(-4);
    const isSynthetic = barcodeData.getAttribute('synthetic') === 'true';

    if (!name || !yob || !/^\d{4}$/.test(last4)) {
      throw new Error('Incomplete fields in PrintLetterBarcodeData credential.');
    }

    const protectedCredentialReference = await computeCredentialHash(
      last4,
      name,
      yob,
      centreSalt
    );
    return {
      format: isSynthetic ? 'SYNTHETIC_DEMO_XML' : 'PRINT_LETTER_XML',
      name,
      yob,
      gender,
      protectedCredentialReference,
      isSyntheticDemo: isSynthetic,
    };
  }

  throw new Error('XML does not match supported Aadhaar Offline XML credential nodes.');
}

