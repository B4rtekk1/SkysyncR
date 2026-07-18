import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatSizeInputValue,
  getFilterSummary,
  hasActiveFileFilters,
  matchesFileFilters,
  parseExcludedExtensions,
  parseSizeInputToMb,
  sortFiles,
} from './fileFilters.ts'
import type { FileFilters, Item } from './types.ts'

const emptyFilters: FileFilters = {
  types: [],
  visibility: 'any',
  minSizeMb: '',
  maxSizeMb: '',
  excludedExtensions: '',
  modifiedFrom: '',
  modifiedTo: '',
}

function item(overrides: Partial<Item>): Item {
  return {
    id: 'file-1',
    filename: 'report.pdf',
    storage_path: 'report.pdf.enc',
    mime_type: 'application/pdf',
    size_bytes: 2 * 1024 * 1024,
    folder_id: null,
    note: null,
    is_deleted: false,
    is_public: false,
    share_token: null,
    share_expires_at: null,
    share_download_limit: null,
    share_download_count: 0,
    is_favourite: false,
    encrypted_key: 'key',
    encryption_nonce: 'nonce',
    created_at: '2026-07-10T10:00:00Z',
    updated_at: '2026-07-12T10:00:00Z',
    deleted_at: null,
    ...overrides,
  } as Item
}

test('parseSizeInputToMb accepts KB and comma decimal input', () => {
  assert.equal(parseSizeInputToMb('1024 KB'), '1')
  assert.equal(parseSizeInputToMb('1,25 mb'), '1.3')
  assert.equal(parseSizeInputToMb('-1 MB'), null)
  assert.equal(parseSizeInputToMb(''), '')
})

test('formatSizeInputValue normalizes megabyte values into readable units', () => {
  assert.equal(formatSizeInputValue('0.5'), '512 KB')
  assert.equal(formatSizeInputValue('2'), '2 MB')
  assert.equal(formatSizeInputValue('bad'), '')
})

test('filter summary and active state reflect selected criteria', () => {
  assert.equal(hasActiveFileFilters(emptyFilters), false)
  assert.equal(getFilterSummary(emptyFilters), 'All files')

  const filters = { ...emptyFilters, types: ['pdf'], visibility: 'public', excludedExtensions: '.tmp, bak' } satisfies FileFilters
  assert.equal(hasActiveFileFilters(filters), true)
  assert.equal(getFilterSummary(filters), '1 type · Shared · 2 excluded')
})

test('parseExcludedExtensions handles dots, whitespace, commas and semicolons', () => {
  assert.deepEqual(parseExcludedExtensions(' .tmp,BAK; log  '), ['tmp', 'bak', 'log'])
})

test('matchesFileFilters applies type, visibility, size, extension and modified ranges', () => {
  const base = item({})
  assert.equal(matchesFileFilters(base, { ...emptyFilters, types: ['pdf'], minSizeMb: '1', maxSizeMb: '3' }), true)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, visibility: 'public' }), false)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, excludedExtensions: 'pdf' }), false)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, modifiedFrom: '2026-07-13' }), false)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, modifiedTo: '2026-07-11' }), false)
})

test('sortFiles keeps manual order by reference and sorts copies for computed keys', () => {
  const items = [
    item({ id: '2', filename: 'file 10.txt', mime_type: 'text/plain', size_bytes: 10, updated_at: '2026-07-10T00:00:00Z' }),
    item({ id: '1', filename: 'file 2.txt', mime_type: 'text/plain', size_bytes: 20, updated_at: '2026-07-12T00:00:00Z' }),
  ]

  assert.equal(sortFiles(items, 'manual'), items)
  assert.deepEqual(sortFiles(items, 'name-asc').map(({ id }) => id), ['1', '2'])
  assert.deepEqual(sortFiles(items, 'size-asc').map(({ id }) => id), ['2', '1'])
  assert.notEqual(sortFiles(items, 'updated-desc'), items)
})
