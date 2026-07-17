# Backend database migrations

Schema changes live in `backend/migrations` and are applied with SQLx before starting the server:

```powershell
cargo run --bin migrate
```

The server does not run schema DDL during normal startup. Deployment should run the migration command after taking an external database backup and before starting the new application version.

Destructive migrations also create SQL-level backup tables in the `migration_backups` schema immediately before dropping columns or deleting incompatible rows.
