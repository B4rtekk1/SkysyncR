FROM node:22-bookworm-slim AS builder

WORKDIR /app/frontend/web

COPY frontend/web/package.json frontend/web/package-lock.json ./
RUN npm ci

COPY frontend/web ./

ARG VITE_API_BASE=/api/
ARG VITE_PUBLIC_URL=http://localhost
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_PUBLIC_URL=${VITE_PUBLIC_URL}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY frontend/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/web/dist /usr/share/nginx/html

EXPOSE 80
