import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import {
  ACTIVE_VIEW_STORAGE_KEY,
  DEFAULT_FILE_FILTERS,
  DEFAULT_NAV_ORDER,
  FILE_FILTER_STORAGE_KEY,
  FILE_SORT_STORAGE_KEY,
  GROUPS_STORAGE_KEY,
  LEGACY_GROUP_INVITES_STORAGE_KEY,
  LAYOUT_MODE_STORAGE_KEY,
  NAV_ORDER_STORAGE_KEY,
  ORDER_STORAGE_PREFIX,
  SIDEBAR_HIDDEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  applySavedOrder,
  clampSidebarWidth,
  clearLegacyLocalFileMetadata,
  loadActiveView,
  loadFileFilter,
  loadFileSort,
  loadGroups,
  loadLayoutMode,
  loadNavOrder,
  loadOrderIds,
  loadSidebarHidden,
  loadSidebarWidth,
  saveActiveView,
  saveFileFilter,
  saveFileSort,
  saveGroups,
  saveLayoutMode,
  saveNavOrder,
  saveOrderIds,
} from './storage.ts'
import type { Item } from './types.ts'

const backingStore = new Map<string, string>()

const localStorageMock = {
  getItem(key: string) {
    return backingStore.has(key) ? backingStore.get(key)! : null
  },
  setItem(key: string, value: string) {
    backingStore.set(key, String(value))
  },
  removeItem(key: string) {
    backingStore.delete(key)
  },
  clear() {
    backingStore.clear()
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => 'generated-group-id' },
  configurable: true,
})

function item(id: string): Item {
  return {
    id,
    filename: `${id}.txt`,
    storage_path: `${id}.txt.enc`,
    mime_type: 'text/plain',
    size_bytes: 1,
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
    created_at: '2026-07-18T10:00:00Z',
    updated_at: '2026-07-18T10:00:00Z',
    deleted_at: null,
  } as Item
}

beforeEach(() => {
  backingStore.clear()
})

test('layout, sort, sidebar and active view loaders reject invalid stored values', () => {
  localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, 'table')
  localStorage.setItem(FILE_SORT_STORAGE_KEY, 'random')
  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '999')
  localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, 'false')
  localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, 'settings')

  assert.equal(loadLayoutMode(), 'grid')
  assert.equal(loadFileSort(), 'manual')
  assert.equal(loadSidebarWidth(), 340)
  assert.equal(loadSidebarHidden(), false)
  assert.equal(loadActiveView(), 'all')
  assert.equal(clampSidebarWidth(71.5), 72)
})

test('save helpers persist values that matching loaders can read', () => {
  saveLayoutMode('list')
  saveFileSort('updated-asc')
  saveActiveView('trash')
  saveNavOrder(['trash', 'all', 'calendar', 'groups', 'shared', 'favourites'])

  assert.equal(loadLayoutMode(), 'list')
  assert.equal(loadFileSort(), 'updated-asc')
  assert.equal(loadActiveView(), 'trash')
  assert.deepEqual(loadNavOrder(), ['trash', 'all', 'calendar', 'groups', 'shared', 'favourites'])
})

test('loadFileFilter migrates legacy filter keys', () => {
  localStorage.setItem(FILE_FILTER_STORAGE_KEY, 'shared')
  assert.deepEqual(loadFileFilter(), { ...DEFAULT_FILE_FILTERS, visibility: 'public' })

  localStorage.setItem(FILE_FILTER_STORAGE_KEY, 'private')
  assert.deepEqual(loadFileFilter(), { ...DEFAULT_FILE_FILTERS, visibility: 'private' })

  localStorage.setItem(FILE_FILTER_STORAGE_KEY, 'pdf')
  assert.deepEqual(loadFileFilter(), { ...DEFAULT_FILE_FILTERS, types: ['pdf'] })
})

test('loadFileFilter sanitizes structured stored filters', () => {
  localStorage.setItem(
    FILE_FILTER_STORAGE_KEY,
    JSON.stringify({
      types: ['image', 'bad', 'code'],
      visibility: 'team',
      tagId: 'tag-1',
      minSizeMb: 12,
      maxSizeMb: '20',
      excludedExtensions: '.tmp',
      modifiedFrom: '2026-07-01',
      modifiedTo: null,
    }),
  )

  assert.deepEqual(loadFileFilter(), {
    ...DEFAULT_FILE_FILTERS,
    types: ['image', 'code'],
    tagId: 'tag-1',
    maxSizeMb: '20',
    excludedExtensions: '.tmp',
    modifiedFrom: '2026-07-01',
  })
})

test('saveFileFilter round-trips complete filter objects', () => {
  const filters = {
    types: ['archive', 'video'],
    visibility: 'private',
    tagId: 'tag-2',
    minSizeMb: '1',
    maxSizeMb: '10',
    excludedExtensions: 'tmp',
    modifiedFrom: '2026-07-01',
    modifiedTo: '2026-07-31',
  } as const

  saveFileFilter(filters)
  assert.deepEqual(loadFileFilter(), filters)
})

test('loadGroups backfills new fields and migrates legacy invites', () => {
  localStorage.setItem(
    GROUPS_STORAGE_KEY,
    JSON.stringify([{ id: 'group-1', name: 'Design', defaultRole: 'editor', createdAt: '2026-07-18T10:00:00Z' }]),
  )

  assert.deepEqual(loadGroups(), [
    {
      id: 'group-1',
      name: 'Design',
      defaultRole: 'editor',
      createdAt: '2026-07-18T10:00:00Z',
      ownerEmail: '',
      ownedByMe: true,
      myRole: 'admin',
      members: [],
      invites: [],
    },
  ])

  localStorage.clear()
  localStorage.setItem(
    LEGACY_GROUP_INVITES_STORAGE_KEY,
    JSON.stringify([{ id: 'invite-1', email: 'user@example.test', role: 'viewer', createdAt: '2026-07-18T10:00:00Z' }]),
  )

  const migrated = loadGroups()
  assert.equal(migrated[0]?.id, 'generated-group-id')
  assert.equal(migrated[0]?.name, 'Main group')
  assert.equal(migrated[0]?.invites[0]?.email, 'user@example.test')
})

test('saveGroups and saved order helpers round-trip through localStorage', () => {
  const groups = [
    {
      id: 'group-1',
      name: 'Design',
      defaultRole: 'viewer',
      createdAt: '2026-07-18T10:00:00Z',
      ownerEmail: 'owner@example.test',
      ownedByMe: false,
      myRole: 'viewer',
      members: [],
      invites: [],
    },
  ] as const

  saveGroups([...groups])
  saveOrderIds('all', ['c', 'a'])

  assert.deepEqual(loadGroups(), groups)
  assert.deepEqual(loadOrderIds('all'), ['c', 'a'])
  assert.deepEqual(JSON.parse(localStorage.getItem(ORDER_STORAGE_PREFIX + 'all') ?? '[]'), ['c', 'a'])
})

test('applySavedOrder puts known ids first and preserves unknown ids after them', () => {
  localStorage.setItem(ORDER_STORAGE_PREFIX + 'all', JSON.stringify(['c', 'a']))

  assert.deepEqual(applySavedOrder([item('a'), item('b'), item('c'), item('d')], 'all').map(({ id }) => id), [
    'c',
    'a',
    'b',
    'd',
  ])
})

test('nav order loader removes unknown entries and appends missing default entries', () => {
  localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(['trash', 'unknown', 'all']))
  assert.deepEqual(loadNavOrder(), ['trash', 'all', 'favourites', 'shared', 'groups', 'calendar'])

  localStorage.setItem(NAV_ORDER_STORAGE_KEY, 'not-json')
  assert.deepEqual(loadNavOrder(), DEFAULT_NAV_ORDER)
})

test('storage failures fall back without throwing', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    },
    configurable: true,
  })

  assert.deepEqual(loadFileFilter(), DEFAULT_FILE_FILTERS)
  assert.deepEqual(loadGroups(), [])
  assert.doesNotThrow(() => {
    saveLayoutMode('list')
    clearLegacyLocalFileMetadata()
  })

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  })
})
