import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SETTINGS,
  clearLegacyProfileStorage,
  loadUserSettings,
  userSettingsStorageKey,
} from './settingsPreferences.ts'
import type { CurrentUserResponse } from '../api/users.ts'

class FakeStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  clear(): void {
    this.values.clear()
  }
}

const local = new FakeStorage()
const session = new FakeStorage()
Object.assign(globalThis, { localStorage: local, sessionStorage: session })

function user(overrides: Partial<CurrentUserResponse> = {}): CurrentUserResponse {
  return {
    id: 'user-1',
    email: 'user@example.test',
    display_name: null,
    avatar_url: null,
    public_key: null,
    default_view: 'all',
    layout_mode: 'grid',
    upload_protection: true,
    compact_metadata: true,
    device_lock: false,
    sync_on_metered: false,
    trash_retention_days: 30,
    ...overrides,
  }
}

test.beforeEach(() => {
  local.clear()
  session.clear()
})

test('userSettingsStorageKey scopes saved preferences by user id', () => {
  assert.equal(userSettingsStorageKey('abc'), 'settings_preferences:abc')
})

test('loadUserSettings returns defaults when no user or saved state exists', () => {
  assert.deepEqual(loadUserSettings(null), DEFAULT_SETTINGS)
})

test('loadUserSettings lets server values override saved preferences', () => {
  local.setItem(
    userSettingsStorageKey('user-1'),
    JSON.stringify({
      displayName: 'Saved Name',
      avatarUrl: 'saved.png',
      defaultView: 'trash',
      layoutMode: 'list',
      deviceLock: true,
      trashRetentionDays: 7,
    }),
  )

  assert.deepEqual(loadUserSettings(user({
    display_name: 'Server Name',
    avatar_url: 'server.png',
    default_view: 'calendar',
    layout_mode: 'grid',
    trash_retention_days: 14,
  })), {
    ...DEFAULT_SETTINGS,
    displayName: 'Server Name',
    avatarUrl: 'server.png',
    defaultView: 'calendar',
    layoutMode: 'grid',
    deviceLock: false,
    trashRetentionDays: 14,
  })
})

test('loadUserSettings falls back to saved view and layout when server values are invalid', () => {
  local.setItem(userSettingsStorageKey('user-1'), JSON.stringify({ defaultView: 'shared', layoutMode: 'list' }))

  assert.deepEqual(loadUserSettings(user({ default_view: 'invalid', layout_mode: 'wide' })), {
    ...DEFAULT_SETTINGS,
    defaultView: 'shared',
    layoutMode: 'list',
  })
})

test('loadUserSettings recovers from malformed storage using server profile identity fields', () => {
  local.setItem(userSettingsStorageKey('user-1'), '{bad json')

  assert.deepEqual(loadUserSettings(user({ display_name: 'Server Name', avatar_url: 'server.png' })), {
    ...DEFAULT_SETTINGS,
    displayName: 'Server Name',
    avatarUrl: 'server.png',
  })
})

test('clearLegacyProfileStorage removes old unscoped profile keys', () => {
  local.setItem('settings_preferences', 'old')
  local.setItem('avatar_url', 'avatar')
  local.setItem('display_name', 'local')
  session.setItem('display_name', 'session')

  clearLegacyProfileStorage()

  assert.equal(local.getItem('settings_preferences'), null)
  assert.equal(local.getItem('avatar_url'), null)
  assert.equal(local.getItem('display_name'), null)
  assert.equal(session.getItem('display_name'), null)
})
