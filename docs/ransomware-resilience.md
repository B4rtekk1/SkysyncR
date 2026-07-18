# Ransomware resilience before AI

SkysyncR should treat recovery and auditability as a product foundation before AI features.

Implemented backend foundation:

- File content updates preserve the previous encrypted blob as a file version.
- A file owner can list historical versions and restore a selected version.
- Download responses include `x-skysyncr-sha256` so clients can verify the encrypted payload after transfer.
- File upload, rename, update, delete, restore, and version restore write audit events with a device label derived from `User-Agent`.
- Permanent trash purge removes active file blobs and stored version blobs.

API surface:

- `GET /files/{id}/versions`
- `POST /files/{id}/versions/{version_id}/restore`
- `GET /files/{id}/activity`
- `GET /files/{id}/download` includes `x-skysyncr-sha256`
- `GET /share/{token}/download` includes `x-skysyncr-sha256`

Remaining work before AI:

- Folder point-in-time restore: persist folder membership/name/deletion snapshots and restore a folder tree as of a timestamp.
- Mass-change detection: group audit events by user/device/time window and flag suspicious bursts of deletes, renames, and rewrites.
- Client-side integrity confirmation: compare downloaded encrypted payload SHA-256 with `x-skysyncr-sha256` and show status in the transfer log.
- Key rotation on new versions: generate and wrap a new content key per file version in the client, then store per-version wrapped keys.
- Device identity: replace raw `User-Agent` labels with stable, user-visible device records tied to sessions.
