import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { Camera, FileCode2, ImageUp, QrCode, ShieldCheck } from 'lucide-react';
import {
  ParsedOfflineCredential,
  parseAadhaarOfflineQr,
  SYNTHETIC_DEMO_QR_SAMPLES,
} from '../lib/aadhaarQr';
import { ModalDialog } from './ui';
import { useI18n } from '../locales/translations';

export function QrScannerModal({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: (cred: ParsedOfflineCredential) => void;
}) {
  const { lang } = useI18n();
  const [mode, setMode] = useState<'camera' | 'upload' | 'demo'>('demo');
  const [error, setError] = useState<string | null>(null);
  const [xmlText, setXmlText] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [qrPreviews, setQrPreviews] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setError(null);
      return;
    }

    // Pre-generate real QR images for synthetic samples so evaluators can inspect/download/scan
    Promise.all(
      SYNTHETIC_DEMO_QR_SAMPLES.map(async (sample) => {
        const url = await QRCode.toDataURL(sample.xmlPayload, {
          width: 180,
          margin: 1,
          color: { dark: '#1B4332', light: '#FFFFFF' },
        });
        return [sample.localReference, url] as const;
      })
    )
      .then((entries) => setQrPreviews(Object.fromEntries(entries)))
      .catch(() => undefined);

    return () => stopCamera();
  }, [open]);

  function stopCamera() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  async function processRawPayload(raw: string) {
    setError(null);
    try {
      const parsed = await parseAadhaarOfflineQr(raw);
      stopCamera();
      onVerified(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse QR credential');
    }
  }

  async function startCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        lang === 'gu'
          ? 'આ ઉપકરણમાં કેમેરા API ઉપલબ્ધ નથી. કૃપા કરીને QR છબી અથવા ડેમો QR વાપરો.'
          : 'Camera API unavailable on this browser/device. Use QR Image Upload or Synthetic Demo QR.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      scanFrameLoop();
    } catch {
      setError(
        lang === 'gu'
          ? 'કેમેરા ઍક્સેસ નકારાયો અથવા મળ્યો નહીં. QR છબી અપલોડ કરો.'
          : 'Camera permission denied or no camera found. Upload a QR image instead.'
      );
    }
  }

  function scanFrameLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (decoded?.data) {
          processRawPayload(decoded.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanFrameLoop);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError('Unable to decode image');
        URL.revokeObjectURL(url);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height);
      URL.revokeObjectURL(url);
      if (!code?.data) {
        setError('No valid QR code found inside uploaded image.');
        return;
      }
      processRawPayload(code.data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Invalid image file.');
    };
    img.src = url;
  }

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      title={lang === 'gu' ? 'આધાર ઓફલાઇન XML QR સ્કેનર' : 'Aadhaar Offline XML QR Scanner'}
      subtitle={
        lang === 'gu'
          ? 'ફક્ત ઉપકરણ પર સ્થાનિક પ્રક્રિયા — કોઈ બાહ્ય API કે કાચો આધાર નંબર સંગ્રહ નહીં'
          : '100% local processing — never transmits raw XML or Aadhaar numbers'
      }
    >
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-900/15 bg-[var(--accent-subtle)] px-3 py-2 text-xs text-[var(--accent)]">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>
          {lang === 'gu'
            ? 'UIDAI ઓફલાઇન XML સ્થાનિક મેપિંગ (અધિકૃત UIDAI ઓનલાઇન પ્રમાણીકરણ નથી)'
            : 'Local Offline XML credential mapping (distinct from live UIDAI authentication)'}
        </span>
      </div>

      {/* Mode tabs */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            setMode('demo');
            stopCamera();
          }}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-semibold ${
            mode === 'demo'
              ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
              : 'border-[var(--border)] bg-[var(--bg-sunken)] text-[var(--text-primary)]'
          }`}
        >
          <QrCode className="h-4 w-4" />
          {lang === 'gu' ? 'ડેમો QR' : 'Demo QR'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('camera');
            startCamera();
          }}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-semibold ${
            mode === 'camera'
              ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
              : 'border-[var(--border)] bg-[var(--bg-sunken)] text-[var(--text-primary)]'
          }`}
        >
          <Camera className="h-4 w-4" />
          {lang === 'gu' ? 'કેમેરા' : 'Camera'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('upload');
            stopCamera();
          }}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-semibold ${
            mode === 'upload'
              ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
              : 'border-[var(--border)] bg-[var(--bg-sunken)] text-[var(--text-primary)]'
          }`}
        >
          <ImageUp className="h-4 w-4" />
          {lang === 'gu' ? 'ફાઇલ / XML' : 'File / XML'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      )}

      {mode === 'camera' && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-black/90">
            <video ref={videoRef} className="h-64 w-full object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
                <Camera className="h-8 w-8 opacity-80" />
                <button type="button" onClick={startCamera} className="k-btn-saffron">
                  {lang === 'gu' ? 'કેમેરા ચાલુ કરો' : 'Enable Camera'}
                </button>
              </div>
            )}
          </div>
          <p className="text-center text-xs text-[var(--text-secondary)]">
            {lang === 'gu'
              ? 'લાભાર્થીના આધાર ઓફલાઇન QR કોડને કેમેરાની સામે રાખો.'
              : 'Hold the beneficiary Aadhaar Offline XML QR steady inside the frame.'}
          </p>
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">
              {lang === 'gu' ? 'QR કોડ છબી અપલોડ કરો (PNG/JPG)' : 'Upload QR Image (PNG / JPG)'}
            </label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageUpload}
              className="k-input py-2 text-sm"
            />
          </div>

          <div className="border-t border-[var(--border)] pt-3">
            <label htmlFor="raw-xml-input" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
              <FileCode2 className="h-4 w-4 text-[var(--accent)]" />
              {lang === 'gu' ? 'અથવા ઓફલાઇન XML પેસ્ટ કરો' : 'Or Paste Aadhaar Offline XML Payload'}
            </label>
            <textarea
              id="raw-xml-input"
              rows={4}
              value={xmlText}
              onChange={(e) => setXmlText(e.target.value)}
              placeholder='<OfflinePaperlessKyc referenceId="..."><UidData><Poi name="..." dob="..." gender="F"/></UidData></OfflinePaperlessKyc>'
              className="k-textarea font-mono-num text-xs"
            />
            <button
              type="button"
              onClick={() => processRawPayload(xmlText)}
              disabled={!xmlText.trim()}
              className="k-btn-primary mt-2 w-full"
            >
              {lang === 'gu' ? 'સ્થાનિક રીતે ચકાસો' : 'Process Offline XML Locally'}
            </button>
          </div>
        </div>
      )}

      {mode === 'demo' && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            {lang === 'gu'
              ? 'પરીક્ષણ માટે નીચેના સિન્થેટિક પંચમહાલ લાભાર્થી QR કોડમાંથી પસંદ કરો (અસલી XML QR જનરેટ અને પાર્સ થાય છે):'
              : 'Select a synthetic Panchmahal beneficiary QR below (parses the embedded Aadhaar Offline XML locally):'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SYNTHETIC_DEMO_QR_SAMPLES.map((sample) => (
              <div
                key={sample.localReference}
                className="flex flex-col items-center rounded-xl border border-[var(--border)] bg-[var(--bg-sunken)]/60 p-3 text-center"
              >
                {qrPreviews[sample.localReference] && (
                  <img
                    src={qrPreviews[sample.localReference]}
                    alt={`Synthetic QR for ${sample.label}`}
                    className="h-28 w-28 rounded-lg border border-[var(--border)] bg-white p-1"
                  />
                )}
                <p className="mt-2 text-xs font-bold text-[var(--text-primary)]">
                  {lang === 'gu' ? sample.labelGu : sample.label}
                </p>
                <p className="font-mono-num text-[11px] text-[var(--text-muted)]">
                  {sample.localReference}
                </p>
                <button
                  type="button"
                  onClick={() => processRawPayload(sample.xmlPayload)}
                  className="k-btn-primary mt-2 min-h-[38px] w-full py-1.5 text-xs"
                >
                  {lang === 'gu' ? 'આ QR સ્કેન કરો' : 'Scan this QR'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalDialog>
  );
}

