# KHORAK (ખોરાક) — Inventory & Supplementary Nutrition Supply Chain Tracker

**Competition:** Seva First Innovation Challenge 2026 — Problem Statement PS000052  
**Region:** Panchmahal District, Godhra, Gujarat (Synthetic Demonstration Dataset)

KHORAK provides digital, batch-level accountability across the ICDS supplementary nutrition supply chain — from GCMMFL/depot dispatch and verified AWW stock receipt to local Aadhaar Offline XML QR beneficiary handover, FEFO expiry control, automated reorder alerts, physical stock reconciliation, and district-level oversight. It complements **POSHAN Tracker** without duplicating child growth monitoring or beneficiary registration.

---

## Architecture & Stack

- **Frontend (`frontend/`)**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, Recharts, Dexie.js (IndexedDB outbox & snapshot cache), `vite-plugin-pwa` Service Worker, `jsqr` + `qrcode` for local Aadhaar Offline XML QR processing.
- **Backend (`backend/`)**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, Zod validation, JWT + bcrypt authentication, Multer persistent local evidence uploads, Helmet & Rate Limiting.
- **Database (`backend/prisma/schema.prisma`)**: Append-only `StockLedgerEvent` table, UUID primary keys, strict idempotency keys, and full organisational hierarchy (`District -> Block -> Sector -> AnganwadiCentre`).

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
| **AWH** | `awh.vavdi` | Vavdi Bujarg AWC-01 (Godhra) | Simplified Mobile App (Stock, Distribution, Consumption) |
| **SUPPLIER** | `supplier.gcmmfl` | GCMMFL Panchmahal | Dispatch Creation, Evidence Upload, Discrepancy Tracking |
| **SUPERVISOR** | `sup.godhra` | Godhra Urban-1 Sector | Discrepancy Review, Physical Reconciliation, Spoilage Approvals, Expiry |
| **CDPO** | `cdpo.godhra` | Godhra Block | Block Inventory, Reorder Alerts, Supplier Monitoring, Deliveries |
| **TDO / BDO** | `tdo.godhra` | Godhra Block | Block Monitoring & Distribution Performance |
| **DPO** | `dpo.panchmahal` | Panchmahal District | District Analytics, Block Comparison, Stockout & Expiry Reports |
| **DDO** | `ddo.panchmahal` | Panchmahal District | Executive District Dashboard & Synthetic Malnutrition Trends |

All seeded beneficiaries, centres, batches, and nutrition aggregates are **synthetic demonstration data**.

---

## Running Automated Acceptance Tests

```bash
npm --prefix backend test
npm --prefix frontend test
```

See [docs/API.md](./docs/API.md) for REST endpoint documentation and deployment notes.

