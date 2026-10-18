#!/bin/bash
set -euo pipefail
umask 077
: "${BACKUP_S3_URI:?Set BACKUP_S3_URI in /etc/equiptags-backup.env}"
if [[ "$BACKUP_S3_URI" != s3://* ]]; then
  echo 'BACKUP_S3_URI must begin with s3://' >&2
  exit 1
fi
backup_dir=/srv/equiptags-backups
backup_file="$backup_dir/equiptags-$(date -u +%Y%m%dT%H%M%SZ).db"
mkdir -p "$backup_dir"
sqlite3 /srv/equiptags/equiptags.db ".backup '$backup_file'"
if [[ "$(sqlite3 "$backup_file" 'PRAGMA integrity_check;')" != ok ]]; then
  echo 'Backup integrity check failed; upload aborted.' >&2
  exit 1
fi
aws s3 cp "$backup_file" "${BACKUP_S3_URI%/}/$(basename "$backup_file")" --sse AES256 --only-show-errors
echo "Verified backup uploaded: $(basename "$backup_file")"
