-- Migration: consolidate UserRole to 3 roles (admin, leadership, partnerships)
-- Run this BEFORE running `prisma db push`

-- Map old roles to new roles
UPDATE "User" SET role = 'partnerships' WHERE role IN ('sales', 'finance', 'project_management', 'clinical_team', 'editorial_team');
-- 'admin', 'leadership', 'partnerships' stay unchanged

-- Verify
SELECT role, COUNT(*) FROM "User" GROUP BY role;
