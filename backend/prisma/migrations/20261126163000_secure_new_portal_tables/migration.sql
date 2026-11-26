-- These tables are accessed through the authenticated Express/Prisma backend.
-- Deny direct Data API access unless an explicit policy is introduced later.
ALTER TABLE "BlockSupplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationalNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianRequest" ENABLE ROW LEVEL SECURITY;
