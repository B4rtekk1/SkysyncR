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
  tagId: '',
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
  assert.equal(parseSizeInputToMb('.5 MB'), '0.5')
  assert.equal(parseSizeInputToMb('0 KB'), '0')
  assert.equal(parseSizeInputToMb('-1 MB'), null)
  assert.equal(parseSizeInputToMb('12 GB'), null)
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

  assert.equal(getFilterSummary({ ...emptyFilters, tagId: 'tag-1' }, [{ id: 'tag-1', owner_id: 'user-1', name: 'Finance', color: null, created_at: '2026-07-12T10:00:00Z' }]), 'Tag: Finance')
})

test('parseExcludedExtensions handles dots, whitespace, commas and semicolons', () => {
  assert.deepEqual(parseExcludedExtensions(' .tmp,BAK; log  '), ['tmp', 'bak', 'log'])
  assert.deepEqual(parseExcludedExtensions('..env .tar.gz'), ['env', 'tar.gz'])
})

test('matchesFileFilters applies type, visibility, size, extension and modified ranges', () => {
  const base = item({})
  assert.equal(matchesFileFilters(base, { ...emptyFilters, types: ['pdf'], minSizeMb: '1', maxSizeMb: '3' }), true)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, visibility: 'public' }), false)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, excludedExtensions: 'pdf' }), false)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, modifiedFrom: '2026-07-13' }), false)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, modifiedTo: '2026-07-11' }), false)
})

test('matchesFileFilters treats invalid size and date inputs as inactive filters', () => {
  const base = item({})

  assert.equal(matchesFileFilters(base, { ...emptyFilters, minSizeMb: 'bad', maxSizeMb: 'also bad' }), true)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, modifiedFrom: 'not-a-date', modifiedTo: 'still-bad' }), true)
})

test('matchesFileFilters distinguishes public and private files', () => {
  assert.equal(matchesFileFilters(item({ is_public: true }), { ...emptyFilters, visibility: 'public' }), true)
  assert.equal(matchesFileFilters(item({ is_public: true }), { ...emptyFilters, visibility: 'private' }), false)
  assert.equal(matchesFileFilters(item({ is_public: false }), { ...emptyFilters, visibility: 'private' }), true)
})

test('matchesFileFilters applies selected tag filter', () => {
  const base = item({})
  const tags = [{ file_id: base.id, tag_id: 'tag-1', name: 'Finance', color: null, created_at: null }]

  assert.equal(matchesFileFilters(base, { ...emptyFilters, tagId: 'tag-1' }, tags), true)
  assert.equal(matchesFileFilters(base, { ...emptyFilters, tagId: 'tag-2' }, tags), false)
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

test('sortFiles supports descending name, updated ascending and largest first ordering', () => {
  const items = [
    item({ id: 'a', filename: 'alpha.txt', size_bytes: 100, updated_at: '2026-07-11T00:00:00Z' }),
    item({ id: 'c', filename: 'charlie.txt', size_bytes: 300, updated_at: '2026-07-10T00:00:00Z' }),
    item({ id: 'b', filename: 'bravo.txt', size_bytes: 200, updated_at: '2026-07-12T00:00:00Z' }),
  ]

  assert.deepEqual(sortFiles(items, 'name-desc').map(({ id }) => id), ['c', 'b', 'a'])
  assert.deepEqual(sortFiles(items, 'updated-asc').map(({ id }) => id), ['c', 'a', 'b'])
  assert.deepEqual(sortFiles(items, 'size-desc').map(({ id }) => id), ['c', 'b', 'a'])
})
