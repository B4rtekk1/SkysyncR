FROM rust:1-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backend/Cargo.toml backend/Cargo.lock ./backend/
COPY backend/migrations ./backend/migrations
COPY backend/src ./backend/src

WORKDIR /app/backend

RUN set -eux; \
    service postgresql start; \
    su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""; \
    su postgres -c "createdb skysyncr_build"; \
    for migration in migrations/*.sql; do \
        PGPASSWORD=postgres psql -h localhost -U postgres -d skysyncr_build -v ON_ERROR_STOP=1 -f "$migration"; \
    done; \
    DATABASE_URL=postgres://postgres:postgres@localhost/skysyncr_build \
    cargo build --release --locked --bin skysyncr-server --bin migrate

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /var/lib/skysyncr --shell /usr/sbin/nologin skysyncr \
    && mkdir -p /var/lib/skysyncr/uploads \
    && chown -R skysyncr:skysyncr /var/lib/skysyncr

COPY --from=builder /app/backend/target/release/skysyncr-server /usr/local/bin/skysyncr-server
COPY --from=builder /app/backend/target/release/migrate /usr/local/bin/skysyncr-migrate

ENV APP_ENV=production \
    LOG_FORMAT=json \
    UPLOAD_DIR=/var/lib/skysyncr/uploads

WORKDIR /app
USER skysyncr

EXPOSE 3000

CMD ["skysyncr-server"]
