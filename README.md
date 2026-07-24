# SkysyncR

## Docker

Run the whole project locally from the repository root:

```powershell
docker compose up -d --build
```

The local stack starts:

- `db`: PostgreSQL 17 available to the app inside the Docker network.
- `migrate`: one-shot SQLx migration job.
- `backend`: Rust API server inside the Docker network.
- `frontend`: Nginx serving the Vite build and proxying `/api/` to the backend.

Open the app at `http://localhost:8080`.

Useful local commands:

```powershell
docker compose ps
docker compose logs -f backend
docker compose down
```

Local uploads and database files are stored in Docker named volumes: `skysyncr_db_data` and `skysyncr_uploads`.

## Production deployment

Create an environment file from the example:

```powershell
Copy-Item infra\docker\.env.prod.example infra\docker\.env.prod
```

Edit `infra\docker\.env.prod` and set strong values for `POSTGRES_PASSWORD` and `JWT_SECRET`.

Build and start the full stack:

```powershell
docker compose --env-file infra\docker\.env.prod -f infra\docker\docker-compose.prod.yml up -d --build
```

Open the app at `http://localhost` or the port configured with `HTTP_PORT`.

Useful commands:

```powershell
docker compose --env-file infra\docker\.env.prod -f infra\docker\docker-compose.prod.yml ps
docker compose --env-file infra\docker\.env.prod -f infra\docker\docker-compose.prod.yml logs -f backend
docker compose --env-file infra\docker\.env.prod -f infra\docker\docker-compose.prod.yml down
```
