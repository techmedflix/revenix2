#!/bin/bash
# MedOS daily PostgreSQL backup
# Stores compressed dumps in ~/Documents/Playground/medos-backups/
# Retains last 30 days automatically

PG_DUMP="/opt/homebrew/Cellar/postgresql@16/16.13/bin/pg_dump"
BACKUP_DIR="$HOME/Documents/Playground/medos-backups"
DB_USER="postgres"
DB_NAME="medos"

mkdir -p "$BACKUP_DIR"

FILENAME="medos_$(date +%Y%m%d_%H%M%S).dump"
FILEPATH="$BACKUP_DIR/$FILENAME"

"$PG_DUMP" -U "$DB_USER" -Fc "$DB_NAME" > "$FILEPATH"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$FILEPATH" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup OK: $FILEPATH ($SIZE)"
  # Keep only last 30 backups
  ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n +31 | xargs rm -f
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup failed for $DB_NAME"
  rm -f "$FILEPATH"
  exit 1
fi
