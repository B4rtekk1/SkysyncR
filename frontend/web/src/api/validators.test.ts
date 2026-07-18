import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiResponseValidationError,
  calendarEntry,
  file,
  group,
  parseApiErrorBody,
  readJson,
  sharedFile,
  storageQuota,
} from './validators.ts'

const validFile = {
  id: 'file-1',
  filename: 'report.pdf',
  storage_path: 'report.pdf.enc',
  mime_type: 'application/pdf',
  size_bytes: 123,
  folder_id: null,
  note: null,
  is_deleted: false,
  is_public: true,
  share_token: 'token',
  share_expires_at: null,
  share_download_limit: null,
  share_download_count: 0,
  is_favourite: false,
  encrypted_key: 'key',
  encryption_nonce: 'nonce',
  created_at: '2026-07-18T10:00:00Z',
  updated_at: '2026-07-18T10:00:00Z',
  deleted_at: null,
}

test('parseApiErrorBody prefers non-empty message over error fallback', () => {
  assert.equal(parseApiErrorBody({ message: 'Readable message', error: 'Fallback' }), 'Readable message')
  assert.equal(parseApiErrorBody({ message: ' ', error: 'Fallback' }), 'Fallback')
  assert.equal(parseApiErrorBody({ error: '' }), null)
  assert.equal(parseApiErrorBody('bad'), null)
})

test('file validator accepts nullable optional server fields', () => {
  assert.deepEqual(file(validFile, 'File'), validFile)
})

test('sharedFile validator rejects unsupported permissions with field path', () => {
  assert.throws(
    () => sharedFile({ ...validFile, permissions: 'owner', shared_by_user_id: 'user-1', shared_by_user_name: null }, 'SharedFile'),
    (err) => err instanceof ApiResponseValidationError && err.message === 'SharedFile.permissions: expected read | download | write',
  )
})

test('group validator validates nested invites and allowed roles', () => {
  const parsed = group(
    {
      id: 'group-1',
      name: 'Design',
      defaultRole: 'editor',
      createdAt: '2026-07-18T10:00:00Z',
      invites: [{ id: 'invite-1', email: 'a@example.test', role: 'viewer', createdAt: '2026-07-18T10:00:00Z' }],
    },
    'Group',
  )

  assert.equal(parsed.invites[0]?.role, 'viewer')
  assert.throws(
    () => group({ ...parsed, invites: [{ ...parsed.invites[0], role: 'owner' }] }, 'Group'),
    /Group\.invites\[0\]\.role/,
  )
})

test('calendarEntry validator accepts only known entry kinds', () => {
  const valid = {
    id: 'entry-1',
    kind: 'event',
    date: '2026-07-18',
    time: '10:00',
    title: 'Meet',
    note: '',
    reminder: '',
    file_id: null,
    created_at: '2026-07-18T10:00:00Z',
    updated_at: '2026-07-18T10:00:00Z',
  }

  assert.equal(calendarEntry(valid, 'CalendarEntry').kind, 'event')
  assert.throws(() => calendarEntry({ ...valid, kind: 'task' }, 'CalendarEntry'), /CalendarEntry\.kind/)
})

test('readJson wraps unexpected validator errors with label context', async () => {
  const response = new Response('{}', { headers: { 'content-type': 'application/json' } })
  await assert.rejects(
    () => readJson(response, () => {
      throw new Error('unexpected')
    }, 'StorageQuota'),
    (err) => err instanceof ApiResponseValidationError && err.message === 'StorageQuota: invalid API response',
  )
})

test('readJson preserves explicit validation errors', async () => {
  const response = new Response(JSON.stringify({ total_bytes: 100, used_bytes: Number.NaN }))
  await assert.rejects(
    () => readJson(response, storageQuota, 'StorageQuota'),
    (err) => err instanceof ApiResponseValidationError && err.message === 'StorageQuota.used_bytes: expected finite number',
  )
})
