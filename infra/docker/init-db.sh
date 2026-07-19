#!/usr/bin/env bash
set -euo pipefail

for migration in /docker-entrypoint-migrations/*.sql; do
  echo "applying ${migration}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file "$migration"
done
