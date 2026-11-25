# KHORAK API & Deployment Reference

## Authentication
- `POST /api/auth/login` — Rate-limited login (`username`, `password`) returning `accessToken` (15m), `refreshToken` (7d), and scoped `user` profile.
- `POST /api/auth/refresh` — Rotates `refreshToken` and issues a fresh `accessToken`.
- `POST /api/auth/logout` — Revokes active refresh token(s) and logs audit event.
- `GET /api/auth/me` — Returns current authenticated user & organisational scope.

## Inventory & Ledger (Append-Only)
- `GET /api/inventory` — Scoped centre inventory summaries (Usable, Expired, Quarantined, Damaged, Days of Stock, Reorder Level).
- `GET /api/inventory/:centreId` — Detailed centre product balances & FEFO batches.
- `GET /api/inventory/:centreId/batches` — Batch balances sorted earliest expiry first (FEFO).
- `GET /api/inventory/:centreId/ledger` — Immutable `StockLedgerEvent` audit trail.
- `POST /api/inventory/receipts` — Direct / opening stock receipt (`idempotencyKey`).
- `POST /api/inventory/consumption` — HCM / authorised stock usage via FEFO allocation.
- `POST /api/inventory/spoilage` — Submit spoilage report (multipart optional evidence photo) for Supervisor approval.
- `POST /api/inventory/reconciliation` — Physical stock count vs ledger balance; generates `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` upon approval.

## Supplier Dispatches & Discrepancies
- `GET /api/dispatches/targets` — Active centres, products, and suppliers.
- `POST /api/dispatches` — Create consignment dispatch (multipart evidence optional), generates unique `dispatchReference`.
- `GET /api/dispatches` — Role-scoped dispatch list.
- `POST /api/dispatches/:id/receipt` — AWW records `acceptedQuantity`, `damagedQuantity`, `missingQuantity`. Automatically creates `DiscrepancyCase` if `accepted !== expected`.
- `GET /api/discrepancies` — Scoped discrepancy cases.
- `POST /api/discrepancies/:id/review` — Supervisor/CDPO action (`APPROVE`, `REQUEST_RECOUNT`, `REJECT`, `RESOLVE`) with mandatory `remarks`.
- `POST /api/approvals/:id/approve` & `POST /api/approvals/:id/reject` — Unified approval handler for `SPOILAGE`, `RECONCILIATION`, and `DISCREPANCY`.

## Beneficiary Offline QR & Distribution
- `GET /api/beneficiaries` — Scoped authorised `BeneficiaryReference` rows (no raw Aadhaar numbers).
- `POST /api/beneficiaries/verify-offline-credential` — Matches locally hashed `protectedCredentialReference`.
- `POST /api/distributions` — Records handover using FEFO, blocks expired/quarantined batches, enforces `idempotencyKey` and same-day duplicate ration protection.

## Alerts, Dashboards & Offline Sync
- `GET /api/alerts` — Scoped reorder (`WARNING` 4–7d, `CRITICAL` 1–3d, `STOCKOUT` 0d), expiry, pending delivery, and discrepancy alerts.
- `GET /api/dashboard/centre` | `/api/dashboard/block` | `/api/dashboard/district` — Role-enforced dashboards (`AWW` receives `403` on `/api/dashboard/district`).
- `GET /api/analytics/inventory` | `distribution` | `suppliers` | `nutrition`
- `POST /api/sync/push` — Idempotent outbox batch processor (`SYNCED`, `CONFLICT`, `FAILED`).
- `GET /api/sync/pull` — Centre offline snapshot for Dexie.js IndexedDB caching.
- `GET /health` — PostgreSQL connectivity health check.

---

## Deployment Steps

1. **Managed PostgreSQL**: Provision a UTF-8 PostgreSQL database (Neon, RDS, Supabase, or Railway) and set `DATABASE_URL`.
2. **Backend (Persistent Node.js host — Render / Railway / Fly.io)**:
   - Configure env vars from `.env.example` (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`, `UPLOAD_DIR` mounted to a persistent volume).
   - Build & migrate: `npm run build && npm run prisma:migrate`.
   - Start: `npm start`.
3. **Frontend (Vercel)**:
   - Set Root Directory to `frontend`.
   - Configure Vercel rewrite (`frontend/vercel.json` included) or API proxy `API_BASE_URL` to your backend HTTPS origin.
   - Build command: `npm run build` (`dist/`).

