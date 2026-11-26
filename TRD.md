# KHORAK (ખોરાક)
## Technical Requirements Document (TRD)

**Version:** 1.0  
**Status:** Development Specification  
**Architecture:** Modular Full-Stack Web Application  
**Primary Deployment:** Cloud-hosted application with offline-capable mobile interface

---

## 1. Technical Overview

### 1.1 Architecture

KHORAK will use a modular client-server architecture.

**Frontend:** Responsive web application / installable PWA.  
**Backend:** REST API server.  
**Database:** Relational PostgreSQL database.  
**Offline Storage:** IndexedDB.  
**Authentication:** JWT-based authentication.  
**QR Processing:** Local Aadhaar Offline XML QR processing.

### 1.2 Actual Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 (`^19.3.1`) + TypeScript (`^7.0.2`) |
| Mobile Packaging | Capacitor 8 (`@capacitor/core@^8.6.3`, `@capacitor/android@^8.6.3`) |
| Build Tool | Vite (`vite@^8.3.8`, `@vitejs/plugin-react@^6.3.0`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite@^4.3.5`) |
| Icons & Charts | Lucide (`lucide-react@^1.80.0`) + Recharts (`^3.11.1`) |
| Routing & Client | React Router (`^7.18.7`) + Native Fetch API |
| Backend | Node.js + Express 5 (`^5.3.0`) + TypeScript |
| ORM & Database | Prisma (`^6.19.3`) + PostgreSQL |
| Offline Storage | Dexie.js (`^4.4.7`) + IndexedDB + Service Worker (`vite-plugin-pwa@^2.0.0`) |
| Authentication | JWT (`jsonwebtoken@^9.0.3`) + `bcryptjs@^3.0.3` |
| Validation | Zod (`^4.6.7`) |
| QR Scanning | Direct camera stream + `jsqr@^1.4.0` + `qrcode@^1.5.4` + Web Crypto HMAC-SHA256 |
| Testing | Vitest (`^5.1.1`) + Supertest (`^7.3.2`) |

The stack should remain modular. Additional libraries should only be introduced when they solve a defined requirement.

---

## 2. System Architecture

### 2.1 Logical Architecture

1. Presentation Layer
   - Role-specific interfaces.
   - Gujarati and English localisation.
   - Responsive layouts.
   - Form validation and feedback.

2. Application Layer
   - Authentication.
   - Role-based authorisation.
   - Inventory operations.
   - Dispatch and receipt management.
   - Distribution processing.
   - Alert generation.
   - Analytics and reporting.

3. Data Layer
   - PostgreSQL database.
   - Prisma data access.
   - Transaction management.
   - Audit records.

4. Offline Layer
   - IndexedDB local storage.
   - Service worker caching.
   - Pending transaction outbox.
   - Synchronisation engine.

### 2.2 Architecture Flow

Frontend → REST API → Authentication & RBAC → Business Services → Prisma → PostgreSQL.

Offline operation:

Frontend → IndexedDB → Pending Outbox → Synchronisation API → Server Validation → PostgreSQL.

---

## 3. Application Modules

### 3.1 Authentication Module
- Login and logout.
- Password hashing using bcrypt.
- JWT issuance and validation.
- Token expiration and refresh strategy.
- Login rate limiting.
- Role and scope validation.
- Account activation and deactivation.

### 3.2 User & Organisation Module
Manage:
- Districts.
- Blocks.
- Sectors.
- Anganwadi Centres.
- Suppliers.
- Users.
- Role assignments.

Every user must have an authorised organisational scope.

### 3.3 Inventory Module
Responsibilities:
- Product catalogue.
- Centre-level inventory.
- Batch-level inventory.
- Stock receipts.
- Stock distributions.
- Consumption.
- Spoilage.
- Adjustments.
- Stock reconciliation.

Inventory balances must be calculated from ledger events or maintained through transactionally consistent balance projections.

### 3.4 Supplier Module
Responsibilities:
- Dispatch creation.
- Dispatch line items.
- Batch assignment.
- Delivery evidence.
- Delivery acknowledgement.
- Discrepancy tracking.
- Supplier performance records.

### 3.5 Distribution Module
Responsibilities:
- QR scanning.
- Beneficiary matching (`BeneficiaryReference` status & category verification).
- Automatic nutrition product resolution via configurable `EntitlementRule`.
- Monthly IST calendar entitlement calculation & remaining ration limit enforcement.
- Authorised exception override & policy confirmation controls (`SUPERVISOR`/`CDPO`/`DPO`/`DDO`).
- Quantity validation & FEFO stock validation.
- Distribution confirmation & duplicate submission prevention.

### 3.6 Alert Module
Responsibilities:
- Low-stock detection.
- Stockout detection.
- Expiry alerts.
- Pending delivery alerts.
- Unresolved discrepancy alerts.

Alerts should be generated using scheduled jobs or event-driven processing. Do not depend on a user opening the dashboard.

### 3.7 Analytics Module
Responsibilities:
- Centre-level inventory summaries.
- Sector and block aggregation.
- District-wide KPIs.
- Distribution reports.
- Supplier fulfilment reports.
- Stockout and expiry analysis.
- Authorised aggregate nutrition indicators.

---

## 4. Database Requirements

Use PostgreSQL with Prisma ORM.

### 4.1 Core Entities

| Entity | Purpose |
|---|---|
| User | User accounts |
| Role | Role definitions |
| District | District records |
| Block | Block records |
| Sector | Sector records |
| AnganwadiCentre | Centre records |
| Supplier | Supplier records |
| BeneficiaryReference | Minimal authorised beneficiary mapping |
| EntitlementRule | Configurable monthly ration rules by beneficiary category |
| Product | Nutrition product catalogue |
| ProductBatch | Batch and expiry information |
| Dispatch | Supplier dispatch header |
| DispatchItem | Dispatched product quantities |
| DeliveryReceipt | Actual received quantities |
| StockLedgerEvent | Immutable stock movements |
| Distribution | Beneficiary distribution records |
| SpoilageReport | Damaged or spoiled stock |
| DiscrepancyCase | Delivery and stock discrepancies |
| Reconciliation | Physical stock verification |
| Approval | Approval and rejection history |
| Notification | User alerts |
| AuditLog | Security and business audit history |
| SyncOperation | Offline transaction synchronisation |
| NutritionAggregate | Authorised aggregate nutrition indicators |

### 4.2 Important Relationships

- District has multiple blocks.
- Block has multiple sectors.
- Sector has multiple Anganwadi Centres.
- Centre maintains multiple batches and stock ledger events.
- Supplier creates multiple dispatches.
- Dispatch contains multiple dispatch items.
- Dispatch may have a delivery receipt.
- Delivery receipt may generate a discrepancy case.
- Distribution references a centre, beneficiary reference, product, and batch.
- Reconciliation generates an adjustment event after approval.
- Users have role assignments and organisational scopes.

### 4.3 Database Constraints

- Use UUID primary keys.
- Use foreign keys for relational integrity.
- Use decimal or integer quantities with consistent units.
- Add indexes to frequently filtered fields.
- Enforce unique dispatch references.
- Enforce idempotency keys for write operations.
- Prevent duplicate distribution transaction IDs.
- Prevent negative usable inventory.
- Preserve audit and ledger history.
- Store timestamps consistently in UTC.

### 4.4 Stock Ledger Design

The ledger is the authoritative history of stock movement.

Supported event types:

- OPENING_STOCK
- RECEIVED
- DISTRIBUTED
- CONSUMED
- SPOILAGE
- ADJUSTMENT_IN
- ADJUSTMENT_OUT
- RECONCILIATION

Each event should include:

- Event ID.
- Centre ID.
- Product ID.
- Batch ID.
- Event type.
- Quantity.
- Reference transaction ID.
- Actor ID.
- Timestamp.
- Remarks.
- Idempotency key.

Ledger entries must not be silently edited or deleted. Corrections must use authorised compensating events.

---

## 5. API Requirements

Use REST APIs with consistent response structures.

### 5.1 Authentication
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/auth/refresh
- GET /api/auth/me

### 5.2 Inventory
- GET /api/inventory
- GET /api/inventory/:centreId
- GET /api/inventory/:centreId/batches
- GET /api/inventory/:centreId/ledger
- POST /api/inventory/receipts
- POST /api/inventory/consumption
- POST /api/inventory/spoilage
- POST /api/inventory/reconciliation

### 5.3 Supplier & Dispatch
- POST /api/dispatches
- GET /api/dispatches
- GET /api/dispatches/:id
- POST /api/dispatches/:id/submit
- POST /api/dispatches/:id/receipt
- GET /api/dispatches/:id/discrepancies

### 5.4 Distribution & Entitlement Rules
- GET /api/entitlements
- GET /api/entitlements/beneficiary/:beneficiaryId
- PUT /api/entitlements/:category (requires `SUPERVISOR`, `CDPO`, `DPO`, or `DDO` + audit `reason`)
- POST /api/distributions (auto-resolves entitled product, enforces monthly IST calendar limits with advisory locking)
- GET /api/distributions
- GET /api/distributions/:id
- POST /api/beneficiaries/verify-offline-credential (returns beneficiary + monthly `entitlement` summary)

### 5.5 Discrepancies & Approvals
- GET /api/discrepancies
- GET /api/discrepancies/:id
- POST /api/discrepancies/:id/review
- POST /api/discrepancies/:id/resolve
- POST /api/approvals/:id/approve
- POST /api/approvals/:id/reject

### 5.6 Alerts & Analytics
- GET /api/alerts
- GET /api/dashboard/centre
- GET /api/dashboard/block
- GET /api/dashboard/district
- GET /api/analytics/inventory
- GET /api/analytics/distribution
- GET /api/analytics/suppliers
- GET /api/analytics/nutrition

- `POST /api/appeals`, `GET /api/appeals`, `POST /api/appeals/:id/submit`, `POST /api/appeals/:id/respond`, `POST /api/appeals/:id/review`
- `POST /api/stock-requests`, `GET /api/stock-requests`, `GET /api/stock-requests/:id`, `POST /api/stock-requests/:id/review`

### 5.7 Synchronisation
- POST /api/sync/push (`CREATE_BENEFICIARY`, single & multi-item `DISTRIBUTION`, `CONSUMPTION`, `SPOILAGE`, `RECEIVE_DISPATCH`, `CREATE_STOCK_REQUEST`)
- GET /api/sync/pull (includes `offlineCredentialSalt` and `stockRequests`)
- GET /api/sync/status
- GET /health & GET /api/health

All endpoints must enforce authentication, role permissions, and organisational data scope on the backend.

---

## 6. Critical Business Logic

### 6.1 Stock Balance

Usable stock must be derived from valid inventory movements and eligible batches.

Conceptually:

Closing Stock = Opening Stock + Receipts + Adjustments In − Distribution − Consumption − Spoilage − Adjustments Out.

Expired, damaged, and quarantined quantities must not be counted as usable stock.

### 6.2 Delivery Discrepancy

Example:

- Dispatched quantity: 100.
- Accepted quantity: 80.
- Missing quantity: 20.

The system must create a discrepancy case for the difference.

Damaged and missing quantities must be separately classified to avoid double-counting.

### 6.3 Days of Stock

Days of Stock = Usable Stock ÷ Average Daily Consumption.

If average daily consumption is zero or insufficient history exists, the system must avoid misleading calculations and clearly identify estimated values.

### 6.4 FEFO

First Expiry, First Out.

Eligible batches should be prioritised by earliest expiry date.

Expired, damaged, and quarantined batches must be excluded.

### 6.5 Transaction Integrity

Every inventory-changing operation must:

1. Validate the authenticated user and scope.
2. Validate product and batch.
3. Check available usable quantity.
4. Check transaction idempotency.
5. Execute ledger and related record updates atomically.
6. Record audit information.
7. Return the committed result.

Use database transactions and appropriate concurrency controls to prevent overselling or double deductions.

---

## 7. Aadhaar Offline XML QR Processing

### 7.1 Functional Requirements

- Support the intended Aadhaar Offline XML QR credential format.
- Process QR content locally in the application.
- Validate the supported credential structure.
- Extract only the minimum fields required for the authorised workflow.
- Match the credential against authorised beneficiary references.
- Display a minimal confirmation screen.
- Avoid transmitting raw credential content to the backend or third-party services.

### 7.2 Security & Privacy Requirements

- Never store or log raw Aadhaar XML or full/partial/last-4 Aadhaar digits.
- Derive per-centre salted HMAC-SHA256 `protectedCredentialReference` locally (`khorak-offline-v2|<name>|<yob>|<last4>` keyed by centre `offlineCredentialSalt`).
- Do not display raw or masked Aadhaar digits anywhere in the UI, logs, notifications, or API payloads.
- Do not use Aadhaar credentials as passwords or authentication tokens.
- Explicitly disclose that offline XML credential mapping is distinct from live UIDAI authentication.
- Use synthetic credentials for development and demonstrations.

Implementation must be checked against the supported UIDAI credential format and applicable legal and operational requirements before production use.

---

## 8. Offline Architecture

### 8.1 Local Storage

Use IndexedDB through Dexie.js.

Cache:
- Authenticated user scope.
- Product catalogue.
- Relevant centre inventory.
- Necessary beneficiary references.
- Pending transactions.
- Synchronisation metadata.

Do not cache unnecessary sensitive data.

### 8.2 Outbox Pattern

Each offline transaction should contain:

- Unique UUID.
- Transaction type.
- Payload.
- User and centre context.
- Creation timestamp.
- Sync status.
- Retry metadata.

### 8.3 Synchronisation Process

1. Detect connectivity.
2. Read pending outbox records.
3. Submit transactions using idempotency keys.
4. Validate user permissions and current server state.
5. Commit accepted transactions.
6. Return success or conflict information.
7. Mark successful transactions as synchronised.
8. Preserve failed transactions for review or retry.

### 8.4 Conflict Handling

- Never silently overwrite server records.
- Prevent duplicate stock deductions.
- Require review for conflicting stock movements.
- Preserve original local transaction details.
- Display clear sync states.

Offline transactions must not be treated as fully committed server transactions until accepted by the backend.

---

## 9. Security Requirements

### Authentication
- Hash passwords with bcrypt.
- Use short-lived access tokens.
- Protect refresh tokens.
- Rate-limit login attempts.
- Invalidate sessions on logout where supported.

### Authorisation
- Enforce RBAC on the backend.
- Enforce centre, sector, block, and district scopes.
- Validate permissions on every protected operation.
- Never rely only on frontend route protection.

### Data Protection
- Use HTTPS.
- Validate and sanitise inputs.
- Protect sensitive beneficiary data.
- Avoid logging sensitive credentials.
- Restrict file uploads by type and size.
- Store uploaded files in private object storage.
- Use environment variables for secrets.

### Audit Logging
Record:
- Actor.
- Action.
- Entity.
- Timestamp.
- Relevant before/after values where appropriate.
- Approval history.
- Transaction reference.

### Additional Protections
- CORS restrictions.
- Secure HTTP headers.
- SQL injection prevention through parameterised ORM operations.
- API request validation.
- File upload validation.
- Rate limiting.
- Dependency security checks.

---

## 10. Frontend Requirements

### 10.1 Application Structure

Suggested frontend structure:

- src/components/
- src/features/auth/
- src/features/inventory/
- src/features/distribution/
- src/features/dispatch/
- src/features/suppliers/
- src/features/alerts/
- src/features/analytics/
- src/features/reconciliation/
- src/features/users/
- src/hooks/
- src/lib/
- src/locales/
- src/routes/
- src/services/
- src/types/

### 10.2 Role-Based Navigation

Navigation must be generated from role permissions.

AWW/AWH:
- Home
- Inventory
- Receive Stock
- QR Distribution
- Usage
- Spoilage
- Sync Status

Supplier:
- Dashboard
- Create Dispatch
- Dispatch History
- Delivery Status
- Discrepancies

Supervisor:
- Dashboard
- Sector Inventory
- Verification
- Discrepancies
- Expiry Monitoring
- Approvals

CDPO:
- Dashboard
- Block Inventory
- Reorder Alerts
- Suppliers
- Delivery Scheduling

DPO/TDO/BDO/DDO:
- Authorised dashboards.
- Inventory analytics.
- Distribution analytics.
- Reports.
- Oversight and monitoring.

### 10.3 UI States

Every important workflow must support:
- Loading.
- Empty state.
- Validation errors.
- API errors.
- Success confirmation.
- Offline state.
- Pending synchronisation.
- Sync failure.
- Permission denied.

---

## 11. Deployment & Infrastructure

### Recommended Setup

Frontend:
- Vercel or equivalent static hosting.

Backend:
- Persistent Node.js hosting.

Database:
- Managed PostgreSQL.

File Storage:
- Private persistent object storage for delivery evidence.

### Environment Configuration

Provide `.env.example` containing:

- DATABASE_URL
- JWT_SECRET
- JWT_REFRESH_SECRET
- FRONTEND_URL
- API_BASE_URL
- STORAGE_CONFIGURATION
- NODE_ENV

Never commit production secrets.

### Deployment Requirements

- Database migrations.
- Production build.
- Environment validation.
- HTTPS.
- Health-check endpoint.
- Error logging.
- Database backup strategy.
- Persistent file storage.
- Deployment documentation.

Do not store production database files on ephemeral hosting storage.

---

## 12. Testing Requirements

### Unit Testing
- Stock calculations.
- Days-of-stock calculations.
- FEFO batch selection.
- Permission checks.
- Discrepancy calculations.
- QR parsing and validation.

### Integration Testing
- Dispatch creation.
- Delivery receipt.
- Inventory ledger update.
- Distribution transaction.
- Reconciliation approval.
- Offline synchronisation.

### End-to-End Testing
- Supplier-to-AWW delivery.
- AWW QR distribution.
- Supervisor discrepancy resolution.
- CDPO reorder monitoring.
- DDO district analytics.

### Required Acceptance Tests

| Test | Expected Result |
|---|---|
| 100 dispatched, 80 received | 20-unit discrepancy |
| Duplicate distribution | Second transaction rejected |
| 40 stock, 8 daily usage | 5 days of stock |
| Expired batch distribution | Blocked |
| Physical 46, ledger 50 | Variance of 4 |
| Offline transaction | Synced once |
| AWW accesses DDO dashboard | Access denied |
| DDO accesses authorised district data | Access granted |

---

## 13. Development Phases

### Phase 1 — Foundation
- Initialise the new project.
- Configure frontend and backend.
- Set up database and migrations.
- Implement authentication and RBAC.
- Establish design system and routing.

### Phase 2 — Inventory & Delivery
- Product and batch management.
- Supplier dispatch.
- AWW receipt.
- Stock ledger.
- Discrepancy detection.

### Phase 3 — Distribution
- Aadhaar Offline XML QR processing.
- Beneficiary matching.
- Distribution recording.
- Stock validation.
- Duplicate prevention.

### Phase 4 — Monitoring
- Expiry alerts.
- Reorder calculations.
- Spoilage reporting.
- Physical reconciliation.
- Supervisor approvals.

### Phase 5 — Dashboards
- Supplier portal.
- Supervisor dashboard.
- CDPO dashboard.
- District and block analytics.

### Phase 6 — Offline & Security
- IndexedDB.
- Outbox synchronisation.
- Conflict handling.
- Security testing.
- Permission testing.

### Phase 7 — Finalisation
- Synthetic demo data.
- Responsive testing.
- Gujarati localisation.
- Bug fixing.
- Deployment.
- Documentation.

---

## 14. Technical Delivery Checklist

- [ ] New independent project initialised.
- [ ] Frontend and backend operational.
- [ ] PostgreSQL schema and migrations.
- [ ] Authentication and backend RBAC.
- [ ] All nine roles represented.
- [ ] Centre, sector, block, and district scoping.
- [ ] Supplier dispatch and delivery acknowledgement.
- [ ] Inventory ledger and batch tracking.
- [ ] Expiry and FEFO logic.
- [ ] Aadhaar Offline XML QR processing.
- [ ] Distribution and duplicate prevention.
- [ ] Spoilage and reconciliation.
- [ ] Discrepancy review and approval.
- [ ] Reorder alerts.
- [ ] District analytics.
- [ ] Offline storage and synchronisation.
- [ ] Gujarati and English interfaces.
- [ ] Synthetic demo data and accounts.
- [ ] Automated tests.
- [ ] `.env.example` and setup instructions.
- [ ] Deployment configuration.
- [ ] Known limitations documented.

**Engineering Principle:** Prioritise complete, tested, database-backed workflows over disconnected UI screens. Every feature represented as functional must be connected to its actual business logic and persistence layer.