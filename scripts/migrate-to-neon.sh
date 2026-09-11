#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  migrate-to-neon.sh
#  Exports all MedOS data from a local (or source) PostgreSQL database and
#  imports it into the Neon production database.
#
#  USAGE
#    ./scripts/migrate-to-neon.sh
#
#  PREREQUISITES
#    - psql and pg_dump installed (brew install postgresql on Mac)
#    - Access to the source PostgreSQL database
#    - The Neon DATABASE_URL (get from Vercel dashboard → Settings → Env Vars,
#      or from the Neon console → Connection Details → Pooled connection)
#
#  WHAT IT DOES
#    1. Prompts for source and target connection strings
#    2. Exports each table to a CSV file in a temp directory
#    3. Truncates all tables on Neon (cascade)
#    4. Imports CSVs in dependency order (respects foreign keys)
#    5. Prints a row-count verification table
#
#  SAFE TO RE-RUN — it always truncates before importing, so no duplicates.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✗${NC} $*"; exit 1; }

# ── Check prerequisites ───────────────────────────────────────────────────────
command -v psql    >/dev/null 2>&1 || error "psql not found. Install with: brew install postgresql"
command -v pg_dump >/dev/null 2>&1 || error "pg_dump not found. Install with: brew install postgresql"

# ── Connection strings ────────────────────────────────────────────────────────
echo ""
echo "MedOS → Neon Migration"
echo "══════════════════════════════════════════════════════════"
echo ""

if [ -z "${SOURCE_DB_URL:-}" ]; then
  echo "Source database URL (local PostgreSQL):"
  echo "  Default: postgresql://postgres@localhost:5432/medos"
  read -rp "  Press Enter to use default, or paste a URL: " SOURCE_INPUT
  SOURCE_DB_URL="${SOURCE_INPUT:-postgresql://postgres@localhost:5432/medos}"
fi

if [ -z "${NEON_DB_URL:-}" ]; then
  echo ""
  echo "Neon target database URL:"
  echo "  (Get from Neon console → Connection Details → Pooled connection)"
  read -rp "  Paste Neon URL: " NEON_DB_URL
fi

[ -z "$NEON_DB_URL" ] && error "Neon URL is required."

# ── Temp directory ────────────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
info "Using temp dir: $TMP_DIR"

# ── Table order (respects foreign key dependencies) ───────────────────────────
# Parent tables first, child tables last.
TABLES=(
  "User"
  "Account"
  "ProjectTypeOption"
  "TaskType"
  "SystemSetting"
  "Opportunity"
  "Activity"
  "Project"
  "Invoice"
  "Receipt"
  "Task"
  "VendorInvoice"
)

# ── Step 1: Export from source ────────────────────────────────────────────────
echo ""
echo "── Step 1: Exporting from source database ───────────────"
for TABLE in "${TABLES[@]}"; do
  COUNT=$(psql "$SOURCE_DB_URL" -tAc "SELECT COUNT(*) FROM \"$TABLE\"" 2>/dev/null || echo "0")
  if [ "$COUNT" -eq 0 ]; then
    warn "$TABLE — empty, skipping"
    # Write empty file so import step still runs (harmless)
    psql "$SOURCE_DB_URL" -c "\copy \"$TABLE\" TO '$TMP_DIR/$TABLE.csv' CSV HEADER" >/dev/null 2>&1 || true
  else
    psql "$SOURCE_DB_URL" -c "\copy \"$TABLE\" TO '$TMP_DIR/$TABLE.csv' CSV HEADER" >/dev/null 2>&1
    info "$TABLE — $COUNT rows exported"
  fi
done

# ── Step 2: Truncate Neon tables ──────────────────────────────────────────────
echo ""
echo "── Step 2: Truncating Neon tables ──────────────────────"
warn "This will DELETE all existing data in Neon. Ctrl+C now to abort."
echo ""
read -rp "  Type YES to continue: " CONFIRM
[ "$CONFIRM" != "YES" ] && error "Aborted."

psql "$NEON_DB_URL" -c '
TRUNCATE
  "VendorInvoice", "Receipt", "Task", "Activity", "Project",
  "Invoice", "Opportunity", "TaskType", "ProjectTypeOption",
  "SystemSetting", "Account", "User"
CASCADE;
' >/dev/null 2>&1
info "All tables truncated"

# ── Step 3: Import to Neon ────────────────────────────────────────────────────
echo ""
echo "── Step 3: Importing to Neon ────────────────────────────"
for TABLE in "${TABLES[@]}"; do
  RESULT=$(psql "$NEON_DB_URL" -c "\copy \"$TABLE\" FROM '$TMP_DIR/$TABLE.csv' CSV HEADER" 2>&1)
  ROWS=$(echo "$RESULT" | grep -oE '[0-9]+' | head -1 || echo "0")
  if echo "$RESULT" | grep -qi "error"; then
    error "$TABLE import failed: $RESULT"
  else
    info "$TABLE — $ROWS rows imported"
  fi
done

# ── Step 4: Verify counts ─────────────────────────────────────────────────────
echo ""
echo "── Step 4: Verification ─────────────────────────────────"
echo ""
printf "%-22s %12s %12s %8s\n" "Table" "Source" "Neon" "Match"
printf "%-22s %12s %12s %8s\n" "─────────────────────" "──────────" "──────────" "─────"

ALL_MATCH=true
for TABLE in "${TABLES[@]}"; do
  SRC=$(psql "$SOURCE_DB_URL" -tAc "SELECT COUNT(*) FROM \"$TABLE\"" 2>/dev/null || echo "?")
  DST=$(psql "$NEON_DB_URL"   -tAc "SELECT COUNT(*) FROM \"$TABLE\"" 2>/dev/null || echo "?")
  if [ "$SRC" = "$DST" ]; then
    MATCH="${GREEN}✓${NC}"
  else
    MATCH="${RED}✗${NC}"
    ALL_MATCH=false
  fi
  printf "%-22s %12s %12s   " "$TABLE" "$SRC" "$DST"
  echo -e "$MATCH"
done

echo ""
if $ALL_MATCH; then
  info "All counts match. Migration complete!"
  echo ""
  echo "  Production URL: https://medos-nextjs.vercel.app"
else
  warn "Some counts don't match — review errors above."
fi
