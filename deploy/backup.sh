#!/bin/bash
set -euo pipefail
umask 077
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
archive="/backups/tranquil-${stamp}.archive.gz"
mongodump --host mongo:27017 --authenticationDatabase admin \
  --username "$(cat /run/secrets/mongo_root_user)" \
  --password "$(cat /run/secrets/mongo_root_password)" \
  --oplog --gzip --archive="$archive"
printf 'Backup written: %s\n' "$archive"
