# KHORAK (ખોરાક) — Inventory & Supplementary Nutrition Supply Chain Tracker

**Competition:** Seva First Innovation Challenge 2026 — Problem Statement PS000052  
**Region:** Panchmahal District, Godhra, Gujarat (Synthetic Demonstration Dataset)

KHORAK provides digital, batch-level accountability across the ICDS supplementary nutrition supply chain — from GCMMFL/depot dispatch and verified AWW stock receipt to local Aadhaar Offline XML QR beneficiary handover, FEFO expiry control, automated reorder alerts, physical stock reconciliation, and district-level oversight. It complements **POSHAN Tracker** without duplicating child growth monitoring or beneficiary registration.

---

## Architecture & Stack

- **Frontend (`frontend/`)**: React 19 (`^19.3.1`), TypeScript (`^7.0.2`), Vite, Tailwind CSS v4, Lucide Icons, Recharts, Dexie.js (`^4.4.7` IndexedDB outbox & snapshot cache), `vite-plugin-pwa` Service Worker, Capacitor 8 (`@capacitor/core@^8.6.3`, `@capacitor/android@^8.6.3`) for installable offline-first Android APKs, and `jsqr` + `qrcode` + Web Crypto HMAC-SHA256 for 100% local Aadhaar Offline XML QR processing.
- **Backend (`backend/`)**: Node.js, Express 5 (`^5.3.0`), TypeScript (`^7.0.2`), Prisma ORM (`^6.19.3`), PostgreSQL, Zod (`^4.6.7`) validation, JWT + bcryptjs authentication, Multer persistent evidence uploads, Helmet & Rate Limiting, and PostgreSQL transactional advisory locks (`pg_advisory_xact_lock`).
- **Database (`backend/prisma/schema.prisma`)**: Append-only `StockLedgerEvent` table, UUID primary keys, strict idempotency keys, DB-level unique daily beneficiary distribution protection, Supervisor→Supplier `DispatchAppeal`, AWW→Supervisor→Supplier `StockRequest`, and full organisational hierarchy (`District -> Block -> Sector -> AnganwadiCentre`).

## Privacy & Aadhaar Handling

- QR scanning runs **100% locally** on the client device. Raw Aadhaar XML and Aadhaar digits (including last-4 digits) are **never stored, displayed, logged, or sent to external services**.
- Only a per-centre salted HMAC-SHA256 `protectedCredentialReference` + minimal display name and birth year (`yob`) are registered and matched. Offline QR mapping is distinct from live UIDAI authentication.

## Building the Offline-First Android APK (Capacitor)

```bash
npm --prefix frontend run build
cd frontend
npx cap sync android
cd android
./gradlew assembleDebug
```
The debug APK is generated at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Quick Start (Local Development)

### 1. Environment Setup
Copy `.env.example` to `backend/.env` and review values (defaults work with the bundled UTF-8 PostgreSQL runner).

```bash
cp .env.example backend/.env
```

### 2. Install Dependencies
```bash
npm --prefix backend install
npm --prefix frontend install
```

### 3. Start PostgreSQL, Migrate, and Seed Panchmahal Demo Data
If you do not have a system PostgreSQL server running on port 5432, start the included UTF-8 PostgreSQL daemon in Terminal 1:
```bash
npm --prefix backend run db:start
```
Then in Terminal 2:
```bash
npm --prefix backend run prisma:migrate
npm --prefix backend run prisma:seed
```

### 4. Run Backend & Frontend
Terminal 2 (Backend on `:4000`):
```bash
npm --prefix backend run dev
```
Terminal 3 (Frontend on `:5173`):
```bash
npm --prefix frontend run dev
```
Open `http://localhost:5173`.

---

## Synthetic Demo Accounts (Password: `Khorak@2026`)

| Role | Username | Scope | Primary Experience |
|---|---|---|---|
| **AWW** | `aww.vavdi` | Vavdi Bujarg AWC-01 (Godhra) | Gujarati-first Mobile App, Offline Outbox, QR Distribution, Stock Receipt |
| **AWH** | `awh.vavdi` | Vavdi Bujarg AWC-01 (Godhra) | Read-only centre stock |
| **SUPPLIER** | `supplier.gcmmfl` | GCMMFL Panchmahal | Dispatch Creation, Evidence Upload, Discrepancy Tracking |
| **SUPERVISOR** | `sup.godhra` | Godhra Urban-1 Sector | Discrepancy Review, Physical Reconciliation, Spoilage Approvals, Expiry |
| **CDPO** | `cdpo.godhra` | Godhra Block | Block Inventory, Reorder Alerts, Supplier Monitoring, Deliveries |
| **TDO / BDO** | `tdo.godhra` | Godhra Block | Block Monitoring & Distribution Performance |
| **DPO** | `dpo.panchmahal` | Panchmahal District | District Analytics, Block Comparison, Stockout & Expiry Reports |
| **DDO** | `ddo.panchmahal` | Panchmahal District | Executive District Dashboard & Synthetic Malnutrition Trends |

All seeded beneficiaries, centres, batches, and nutrition aggregates are **synthetic demonstration data**.

## Beneficiary login and live updates

The sign-in screen has separate Staff and Beneficiary portals. Beneficiaries can only view their own recorded THR distributions and remaining quota for the current calendar month in India. Public registration and family support requests have been removed. Existing request records are retained for historical integrity but are no longer exposed by the API.

AWWs can issue a login under Profile → Beneficiary login access; supervisors can do so under Beneficiary approvals. Select an approved beneficiary after verifying their identity, create their username and password, and share the credentials privately. One account links to one beneficiary. Inactive or unapproved records are hidden; unlinked legacy accounts see a verification message. This does not issue stock or change eligibility.

Desktop layouts use a workspace sidebar and wider data views. Phone layouts use compact navigation, safe-area spacing, and touch-friendly controls. On the AWW home screen, the Namaste card precedes sync status and notifications.

Active dashboards refresh every 10 seconds and on reconnect, focus, app resume, and successful changes. The refresh indicator reports errors without clearing the session. AWH, DPO, TDO and DDO accounts cannot mutate operational data. Sector, block, district and supplier scopes are enforced by the API.

## Android local testing

Set `VITE_API_BASE_URL` to the backend address reachable by the phone, then run `npm --prefix frontend run build:android`. For local HTTP testing only, also set `CAPACITOR_ALLOW_CLEARTEXT=true`. From `frontend/android`, run `bash ./gradlew assembleDebug` with Java 21 and Android SDK 36 available. The installable debug APK is produced at `app/build/outputs/apk/debug/app-debug.apk`.

For a LAN build, keep the computer and phone on the same Wi-Fi and keep the backend running with its configured database connection. Do not use `localhost` as the phone's API address. Rebuild if the computer's LAN address changes. Production app and web builds should use the same HTTPS API origin. This local APK is a test build, not a signed production release.

---

## Running Automated Acceptance Tests

```bash
npm --prefix backend test
npm --prefix frontend test
```

See [docs/API.md](./docs/API.md) for REST endpoint documentation and deployment notes.

