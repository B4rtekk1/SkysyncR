# Ransomware resilience before AI

Skysync should treat recovery and auditability as a product foundation before AI features.

Implemented backend foundation:

- File content updates preserve the previous encrypted blob as a file version.
- A file owner can list historical versions and restore a selected version.
- Folder and file metadata mutations preserve before-change snapshots so folder trees can be restored to a selected timestamp.
- Download responses include `x-skysync-sha256` so clients can verify the encrypted payload after transfer.
- File upload, rename, update, delete, restore, and version restore write audit events with a device label derived from `User-Agent`.
- Recent file mutation audit events are grouped by user, device, and a 10-minute window to detect suspicious bursts of deletes, renames, and encrypted content overwrites.
- Suspicious bursts create a deduplicated `security.ransomware_suspected` notification with counts, affected file totals, time bounds, and triggered signal names.
- Permanent trash purge removes active file blobs and stored version blobs.

API surface:

- `GET /files/{id}/versions`
- `POST /files/{id}/versions/{version_id}/restore`
- `POST /folders/{id}/restore-point` with `restore_at` restores the folder tree, names, file membership, trash state, and file content versions as of that timestamp.
- `GET /files/{id}/activity`
- `GET /files/{id}/download` includes `x-skysync-sha256`
- `GET /share/{token}/download` includes `x-skysync-sha256`
- `GET /notifications` surfaces `security.ransomware_suspected` alerts

Current mass-change detection thresholds:

- 10 or more deletes in 10 minutes.
- 15 or more renames in 10 minutes.
- 20 or more content overwrites in 10 minutes.
- 30 or more mixed mutations across at least 20 affected files in 10 minutes.
- Alerts are deduplicated per user and device for 30 minutes.

Remaining work before AI:

- Client-side integrity confirmation: compare downloaded encrypted payload SHA-256 with `x-skysync-sha256` and show status in the transfer log.
- Key rotation on new versions: generate and wrap a new content key per file version in the client, then store per-version wrapped keys.
- Device identity: replace raw `User-Agent` labels with stable, user-visible device records tied to sessions.
