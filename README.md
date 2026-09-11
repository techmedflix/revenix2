# MedOS (Medflix Operating System)

MedOS is a unified platform for Medflix to manage:
- CRM activities and opportunity pipeline
- Pharma account hierarchy (company > cluster > division > brand)
- Won-project execution, milestone invoicing, and cost tracking
- Cashflow forecasting and runway simulation
- Leadership and sales analytics dashboards
- Google OAuth login with pending approval and role-based access control

## Stack
- Next.js 14 (App Router)
- Prisma ORM
- PostgreSQL
- NextAuth (Google OAuth)
- Recharts

## Roles
- `admin`
- `sales`
- `finance`
- `leadership`

## User status flow
1. User signs in with Google (`@medflix.app` only).
2. First login creates user with `status = pending`.
3. Admin approval is required before access.
4. Revoked users are blocked by middleware and callbacks.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env` (minimum):
   ```bash
   DATABASE_URL="postgresql://..."
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="..."
   GOOGLE_CLIENT_ID="..."
   GOOGLE_CLIENT_SECRET="..."
   ```
3. Optional email config for access alerts:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
   - or `GMAIL_USER`, `GMAIL_APP_PASSWORD`
   - or `RESEND_API_KEY`
4. Push schema:
   ```bash
   npm run db:push
   ```
5. Seed demo data:
   ```bash
   npm run db:seed
   ```
6. Start dev server:
   ```bash
   npm run dev
   ```

## Key API modules
- `/api/accounts`
- `/api/opportunities`
- `/api/activities`
- `/api/projects`
- `/api/invoices`
- `/api/costs`
- `/api/dashboard`
- `/api/cashflow`
- `/api/sales`
- `/api/users`
- `/api/settings`

## Seed coverage
- Account hierarchy: Sun Pharma, Pfizer, Alkem, Cipla, BI, Takeda
- Opportunities: 14
- Projects: 6
- Invoices: 18
- Activities: 27
- Costs: 12
 
 