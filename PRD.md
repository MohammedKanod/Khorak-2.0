# KHORAK (ખોરાક)
## Product Requirements Document (PRD)

**Version:** 1.0  
**Status:** Development Specification  
**Product:** KHORAK  
**Domain:** Anganwadi Inventory & Nutrition Supply Chain Management  
**Initial Deployment Region:** Panchmahal, Gujarat, India

---

## 1. Product Overview

### 1.1 Product Vision

KHORAK is a digital inventory and nutrition supply-chain management platform designed to improve transparency, accountability, and operational efficiency across Anganwadi Centres.

It connects suppliers, Anganwadi workers, supervisors, and district administrators through a unified system for managing nutrition stock, deliveries, distribution, expiry, and inventory intelligence.

### 1.2 Problem Statement

Anganwadi inventory and nutrition supply-chain operations face challenges including:

- Paper-based stock records and manual reporting.
- Limited visibility into stock availability across centres.
- Delayed identification of shortages and expired products.
- Lack of structured dispatch-to-receipt verification.
- Difficulty identifying distribution discrepancies.
- Limited district-level supply-chain intelligence.

### 1.3 Proposed Solution

KHORAK provides:

- Digital, batch-level inventory management.
- Supplier dispatch and delivery verification.
- Aadhaar Offline XML QR-based beneficiary identification.
- Digital distribution and stock consumption records.
- Automated reorder and expiry alerts.
- Offline-capable operations with synchronisation.
- Role-specific dashboards and district analytics.

KHORAK complements existing ICDS and POSHAN Tracker workflows rather than attempting to replace them.

---

## 2. Product Objectives

1. Digitise Anganwadi stock and inventory records.
2. Improve accountability from supplier dispatch to centre receipt.
3. Reduce stockouts through consumption-based reorder alerts.
4. Minimise wastage through batch and expiry tracking.
5. Improve beneficiary handover verification.
6. Reduce manual reporting overhead.
7. Provide administrators with reliable, aggregated supply-chain intelligence.
8. Support operations in areas with unreliable internet connectivity.

### 2.1 Success Metrics

| Metric | Target |
|---|---|
| Inventory transaction traceability | 100% |
| Duplicate distribution prevention | 100% |
| Dispatch-receipt discrepancy detection | 100% |
| Reorder alert generation | Based on configured thresholds |
| Expiry tracking | All tracked batches |
| Offline transaction preservation | No acknowledged local transaction loss |
| Role-based access enforcement | All protected API operations |
| Stock balance accuracy | Reconciled against ledger |

Targets are product acceptance goals, not claims of achieved field performance.

---

## 3. User Roles & Permissions

### 3.1 Anganwadi Worker (AWW)
- Receive stock deliveries.
- View centre inventory.
- Scan Aadhaar Offline XML QR credentials.
- Record beneficiary nutrition distribution.
- Report damaged or spoiled stock.
- Record stock consumption.
- View alerts and transaction history.
- Synchronise offline records.

### 3.2 Anganwadi Helper (AWH)
- View centre stock.
- Assist with distribution.
- Scan beneficiary QR credentials.
- Record authorised consumption and distribution activities.

### 3.3 Supplier (GCMMFL)
- Create dispatch records.
- Enter product, batch, and quantity details.
- Upload delivery evidence.
- Track delivery acknowledgement.
- View discrepancies and delivery status.

### 3.4 Supervisor (Mukhya Sevika)
- Monitor sector-level inventory.
- Verify physical stock.
- Review delivery discrepancies.
- Approve or reject stock adjustments.
- Monitor expiry and stockout risks.
- Review centre-level performance.

### 3.5 CDPO
- Monitor block-level operations.
- View reorder alerts.
- Monitor supplier performance.
- Coordinate delivery schedules.
- Oversee unresolved discrepancies.

### 3.6 DPO
- Access district inventory analytics.
- Compare block-wise stock availability.
- Monitor distribution efficiency.
- Review stockout, expiry, and discrepancy reports.

### 3.7 TDO / BDO
- Monitor assigned block-level operations.
- View inventory status.
- Monitor distribution performance.

### 3.8 DDO
- Access district-wide dashboards.
- Monitor operational performance trends.
- View aggregated nutrition and malnutrition trends.
- Access reports and administrative oversight tools.

### 3.9 Beneficiary
- Present an Aadhaar Offline XML QR credential for verification.
- Receive recorded nutrition handovers through the AWW workflow.

A separate beneficiary application is not required.

---

## 4. Functional Requirements

### FR-01: Authentication & Access Control
- Secure login and logout.
- Role-based permissions.
- Centre, sector, block, and district data restrictions.
- User account management.
- Session and authentication error handling.

### FR-02: Inventory Management
- Maintain centre-level stock records.
- Track products and individual batches.
- Record opening stock, receipts, distributions, consumption, spoilage, and adjustments.
- Display usable stock and stock movement history.
- Prevent negative inventory.
- Maintain an auditable transaction history.

### FR-03: Batch & Expiry Management
- Store batch number, quantity, supplier, manufacturing date when available, and expiry date.
- Track batch-level stock.
- Generate approaching-expiry alerts.
- Exclude expired, damaged, or quarantined stock from usable inventory.
- Support FEFO (First Expiry, First Out).

### FR-04: Supplier & Dispatch Management
- Create unique dispatch references.
- Select destination Anganwadi Centre.
- Record products, batches, quantities, and dispatch dates.
- Upload delivery evidence.
- Track acknowledgement and delivery status.

### FR-05: Delivery Verification
- Allow AWW to record actual received quantities.
- Record accepted, missing, and damaged quantities.
- Automatically calculate discrepancies.
- Allow supervisors to investigate and resolve discrepancies.
- Require remarks for approvals and adjustments.

### FR-06: Beneficiary Registration, Verification & Multi-Item Distribution
- QR-first beneficiary onboarding: AWW taps **Scan Aadhaar QR**, camera opens directly, local XML parser extracts minimal display name and birth year plus a centre-salted HMAC-SHA256 `protectedCredentialReference`, and shows a confirmation card before submission (with offline queueing and manual registration fallback when QR is unavailable).
- Strict privacy: zero raw, partial, or last-4 masked Aadhaar digits are ever displayed in UI, logs, notifications, or API payloads, and raw XML never leaves the device.
- Distribution opens directly on the prominent camera QR scanner; once verified against authorised local records, AWW may add one or more nutrition items (`+ Add Another Item`) in a single atomic checkout.
- Enforce FEFO allocation, exclude expired/damaged/quarantined stock, validate usable balances with transactional concurrency locks, and prevent same-day duplicate handouts per beneficiary/product.

### FR-06B: Connected Supervisor Appeals & AWW Stock Requests
- **Dispatch Appeals**: Supervisors/CDPOs can raise formal shortage/damage appeals linked to discrepancy cases, attach evidence, receive owning-supplier responses, and resolve or escalate through an auditable history trail.
- **Stock Requests**: AWWs/AWHs can request stock replenishment online or offline; Supervisors review (`APPROVE`, `PARTIAL_APPROVE`, `REJECT`) without self-approval; approvals unlock supplier fulfillment dispatches without directly modifying inventory until physical receipt confirmation.

### FR-07: Stock Usage & Spoilage
- Record HCM ingredient consumption.
- Record THR distribution.
- Report damaged, spoiled, or unusable stock.
- Capture quantity, reason, batch, date, and remarks.
- Update inventory through ledger events.

### FR-08: Reorder Alerts
Calculate:

**Days of Stock = Usable Stock ÷ Average Daily Consumption**

Default alert thresholds:

- More than 7 days: Normal.
- 4–7 days: Warning.
- 1–3 days: Critical.
- 0 days: Stockout.

Thresholds must be configurable.

If insufficient consumption history exists, use a configured estimate and clearly label the result as estimated.

### FR-09: Offline Operation
- Cache essential application data.
- Allow supported inventory and distribution operations offline.
- Store pending transactions locally.
- Synchronise when connectivity returns.
- Prevent duplicate submissions.
- Display pending, synced, and failed transaction states.

### FR-10: District Analytics
Provide authorised dashboards containing:

- Total registered centres.
- Usable inventory.
- Centres below seven days of stock.
- Stockout centres.
- Expiring batches.
- Pending deliveries.
- Delivery fulfilment rate.
- Distribution efficiency.
- Unresolved discrepancies.
- Block-wise inventory comparison.
- Aggregated nutrition and malnutrition trends.

Nutrition indicators must come from authorised aggregate data or clearly labelled synthetic demonstration data.

---

## 5. Product Categories

### Take-Home Ration (THR)
- Packaged nutrition products.
- Batch-level stock management.
- Beneficiary-wise distribution.
- QR-based verification.
- Expiry tracking.

### Hot Cooked Meal (HCM)
- Raw ingredient inventory.
- Ingredient receipt and consumption.
- Remaining stock.
- Spoilage and wastage records.

The initial product scope does not include meal planning, recipes, calorie calculations, or kitchen scheduling.

---

## 6. Core User Workflows

### Workflow A: Supplier Delivery

1. Supplier creates a dispatch.
2. Supplier specifies destination, products, batches, and quantities.
3. AWW receives the delivery.
4. AWW records actual quantities received.
5. System compares dispatched and received quantities.
6. Discrepancy case is generated when quantities differ.
7. Supervisor reviews and resolves the case.
8. Inventory ledger records the accepted stock.

### Workflow B: Beneficiary Distribution

1. AWW opens distribution.
2. Scans the beneficiary's Aadhaar Offline XML QR.
3. System processes the supported credential locally.
4. Beneficiary is matched against authorised local records.
5. AWW selects product and quantity.
6. System validates stock and batch eligibility.
7. Distribution is confirmed.
8. Ledger and distribution history are updated.

### Workflow C: Reorder Alert

1. System calculates usable stock.
2. System calculates average daily consumption.
3. Days of stock are calculated.
4. Thresholds are evaluated.
5. Alerts are generated for authorised personnel.
6. CDPO can review and coordinate replenishment.

### Workflow D: Stock Reconciliation

1. Supervisor initiates physical verification.
2. Physical quantity is entered.
3. System compares physical stock with ledger balance.
4. Variance is recorded.
5. Supervisor submits an adjustment for approval.
6. Authorised adjustment creates a new ledger event.
7. Original transactions remain unchanged.

---

## 7. User Interface Requirements

### Design System
- Forest Green: #1B4332
- Saffron/Ochre: #D97706
- Off-White: #FBF9F5
- Clean, professional, accessible visual language.
- Gujarati-first interface with English option.

### AWW Mobile Interface
Prioritise:
- Large touch targets.
- Simple navigation.
- Minimal data entry.
- Clear stock indicators.
- Prominent QR scanning.
- Easy delivery acknowledgement.
- Offline and sync status visibility.
- Readable Gujarati typography.

### Administrative Interface
- Role-specific dashboards.
- Sidebar navigation.
- KPI summaries.
- Searchable and filterable tables.
- Charts with meaningful labels.
- Drill-down views.
- Exception and approval queues.

### Supplier Interface
- Dispatch creation.
- Delivery records.
- Evidence upload.
- Delivery status and discrepancy tracking.

### Responsive Support
- Small Android phones.
- Standard mobile screens.
- Tablets.
- Desktop browsers.

---

## 8. Non-Functional Requirements

- Security: protected APIs, role-based authorisation, audit logs.
- Reliability: atomic inventory transactions and duplicate prevention.
- Performance: responsive navigation and efficient data retrieval.
- Availability: graceful offline operation for supported workflows.
- Usability: Gujarati-first workflows suitable for non-technical users.
- Scalability: support multiple districts and centres.
- Maintainability: modular frontend and backend architecture.
- Accessibility: readable text, sufficient contrast, clear feedback.
- Data integrity: immutable stock transaction history.

---

## 9. Scope & Priorities

### P0 — Essential
- Authentication and RBAC.
- AWW dashboard.
- Supplier dispatch.
- Delivery acknowledgement.
- Inventory ledger.
- Batch and expiry management.
- Aadhaar Offline XML QR processing.
- Beneficiary distribution.
- Discrepancy detection.
- Reorder alerts.

### P1 — Important
- Supervisor approvals.
- Offline operation and synchronisation.
- CDPO dashboard.
- District analytics.
- Reports and exports.
- Spoilage and reconciliation workflows.

### P2 — Future Expansion
- Official government system integrations, subject to authorisation.
- Advanced demand forecasting.
- Additional district deployments.
- More advanced analytics and reporting.

---

## 10. Out of Scope

- Replacing POSHAN Tracker.
- Duplicating child growth monitoring and beneficiary registration.
- Building a separate beneficiary mobile application.
- Unauthorised Aadhaar authentication.
- Automated government-system integrations without approved APIs.
- Meal recipes and calorie calculations.
- Unsupported real-world malnutrition statistics.

---

## 11. Acceptance Criteria

1. A dispatch of 100 units and receipt of 80 units creates a discrepancy of 20.
2. A valid synthetic Aadhaar Offline XML QR can be processed and used in a distribution workflow.
3. Duplicate distribution submissions do not deduct stock twice.
4. Forty usable units at eight units daily consumption generate a five-day stock warning.
5. Expired batches cannot be used for distribution.
6. Physical stock of 46 against ledger stock of 50 creates a variance of four without overwriting history.
7. An offline transaction synchronises exactly once.
8. An AWW cannot access district administrative data.
9. A DDO can access authorised district-level analytics.
10. All important workflows display clear loading, success, error, and sync states.

---

## 12. Demo Data & Deployment

- Use synthetic Panchmahal district data.
- Include multiple blocks, sectors, and Anganwadi Centres.
- Include synthetic users for every role.
- Include suppliers, products, batches, dispatches, receipts, distributions, and discrepancies.
- Use synthetic beneficiaries and credentials.
- Clearly label all demonstration data.
- Provide demo accounts and setup instructions.

**Final Deliverable:** A working, responsive, Gujarati-first supply-chain management platform with inventory traceability, QR-based distribution, delivery verification, offline support, and administrative analytics.