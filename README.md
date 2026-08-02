# Skysync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/backend-Rust-DEA584?logo=rust)](backend)
[![React](https://img.shields.io/badge/frontend-React-61DAFB?logo=react&logoColor=111827)](frontend/web)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/containers-Docker-2496ED?logo=docker&logoColor=white)](compose.yaml)

Skysync is a self-hosted workspace for storing, organising, sharing, and recovering files without giving up control of their contents. Files are encrypted in the browser before upload, while a Rust API, PostgreSQL, and Docker-based deployment provide a straightforward full-stack experience.

![Skysync dashboard](frontend/web/src/assets/icon.png)

## Key functionality

- **Client-side encryption** — files are encrypted locally with AES-256-GCM before transfer. Per-file keys are wrapped for the owner or authorised recipients, so the stored file blobs remain encrypted.
- **Secure accounts** — email verification, password reset with a recovery key, refresh-token rotation, device-aware sessions, trusted-session management, and TOTP-based two-factor authentication.
- **Files that stay organised** — upload and download files, create nested folders, rename items, search and filter, add favourites and coloured tags, and retain file version history.
- **Flexible sharing** — share files and folders privately with users or create public links with optional password protection, expiry dates, download limits, and one-time access.
- **Safe recovery** — use Trash with a configurable retention period, restore files or folders, restore folder state at a point in time, and export your account data as a TAR archive with recovery instructions.
- **Teams and planning** — create groups with role-based access, manage shared content, and keep track of work through the built-in calendar and reminders.
- **Visibility and resilience** — review file and account activity, receive security notifications for new logins, and use ransomware-resilience checks to help protect stored data.

## Technology

| Layer | Stack |
| --- | --- |
| Web app | React 19, TypeScript, Vite |
| API | Rust, Axum, Tokio, SQLx |
| Data | PostgreSQL 17 |
| Cryptography | Web Crypto API, AES-256-GCM, RSA-OAEP, TOTP |
| Deployment | Docker Compose, Nginx |

## Quick start

### Prerequisites

- Docker Desktop with Docker Compose v2

### Run locally

From the repository root, build and start the complete development stack:

```powershell
docker compose up -d --build
```

Open [http://localhost:8080](http://localhost:8080). The stack starts PostgreSQL, runs database migrations, launches the Rust API, and serves the Vite frontend with hot reload.

Useful commands:

```powershell
docker compose ps
docker compose logs -f backend
docker compose down
```

Database data and uploaded encrypted blobs persist in the `skysync_db_data` and `skysync_uploads` Docker volumes. Frontend source files are bind-mounted; polling is enabled by default for reliable file watching on Docker Desktop and OneDrive-backed folders. Set `VITE_USE_POLLING=false` if native file watching works on your machine.

## Configuration

The development Compose file provides safe-for-local-development defaults. Before deploying anywhere public, provide strong, unique values for at least:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | PostgreSQL database password |
| `JWT_SECRET` | Signing secret for access tokens |
| `TOTP_ENCRYPTION_KEY` | Encryption key for server-side TOTP secrets |
| `CORS_ORIGINS` | Allowed frontend origin or origins |
| `FRONTEND_URL` | Public frontend URL used in email verification and password-reset links |
| `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_EMAIL`, `SMTP_PASSWORD` | Email verification and password-reset delivery |
| `FROM_EMAIL` | Sender displayed in email messages |
| `MAX_FILE_SIZE_BYTES` | Maximum accepted upload size; defaults to 1 GiB |

## Production deployment

Create a production environment file from the supplied example:

```powershell
Copy-Item infra\docker\.env.prod.example infra\env\.env.prod
```

Edit `infra\env\.env.prod`, set `FRONTEND_URL` to the public HTTPS address of the application, then build and start the production stack:

```powershell
docker compose --env-file infra\env\.env.prod -f infra\docker\docker-compose.prod.yml up -d --build
```

The application is available at `http://localhost` by default, or at the port configured through `HTTP_PORT`.

## Development

### Frontend

```powershell
Set-Location frontend\web
npm ci
npm run dev
npm run lint
npm test
npm run build
```

### Backend

Migrations live in `backend/migrations` and are applied explicitly rather than during normal server start-up:

```powershell
Set-Location backend
cargo run --bin migrate
cargo test
```

Integration tests reset the `public` schema before each run. Point `DATABASE_URL` only to a disposable database whose name contains `test`:

```powershell
docker compose exec db psql -U skysync -d skysync -c "CREATE DATABASE skysync_test;"
Set-Location backend
$env:DATABASE_URL = "postgres://skysync:skysync_dev_password@127.0.0.1:5433/skysync_test"
$env:JWT_SECRET = "change-me-at-least-32-bytes-for-tests"
cargo test
```

## API and security

- The API contract is available in [common/openapi.json](common/openapi.json).
- Read the [privacy threat model](docs/privacy-threat-model.md) for the encryption model, trust boundaries, and limitations.
- Read [ransomware resilience](docs/ransomware-resilience.md) for protection and recovery design details.
- See [SECURITY.md](SECURITY.md) to report a vulnerability responsibly.

## License

Skysync is distributed under the [MIT License](LICENSE).
