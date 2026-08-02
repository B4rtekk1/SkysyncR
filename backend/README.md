# Backend database migrations

Schema changes live in `backend/migrations` and are applied with SQLx before starting the server:

```powershell
cargo run --bin migrate
```

The server does not run schema DDL during normal startup. Deployment should run the migration command after taking an external database backup and before starting the new application version.

Destructive migrations also create SQL-level backup tables in the `migration_backups` schema immediately before dropping columns or deleting incompatible rows.

## Integration tests

Integration tests reset the `public` schema before each test, so `DATABASE_URL` must point at a disposable database whose name contains `test`.

If you use the local PostgreSQL container from `infra/docker/docker-compose.yml`, create a separate test database once:

```powershell
docker exec postgres psql -U admin -d appdb -c "CREATE DATABASE appdb_test;"
```

Then run the backend tests with the test database URL:

```powershell
Set-Location backend
$env:DATABASE_URL = "postgres://admin:admin@127.0.0.1:5433/appdb_test"
$env:JWT_SECRET = "change-me-at-least-32-bytes-for-tests"
cargo test
```

Do not point integration tests at `appdb` unless you deliberately set `SKYSYNC_ALLOW_NON_LOCAL_TEST_DB_RESET=true`; the tests will drop and recreate schemas.
