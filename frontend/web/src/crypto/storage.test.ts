import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptPrivateKey, encryptPrivateKey, generateKeyPair } from './keys.ts'
import {
  clearActivePrivateKeys,
  loadActivePrivateKey,
  storeActivePrivateKey,
} from './storage.ts'

type Listener = (event: Event) => void

class FakeWindow extends EventTarget {
  timeoutCallback: (() => void) | null = null

  setTimeout(callback: () => void): number {
    this.timeoutCallback = callback
    return 1
  }

  clearTimeout(): void {
    this.timeoutCallback = null
  }
}

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
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

class FakeCustomEvent<T = unknown> extends Event {
  detail: T

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type)
    this.detail = init?.detail as T
  }
}

function createRequest<T>(): IDBRequest<T> {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  } as IDBRequest<T>
}

function createFakeIndexedDb(): IDBFactory {
  const values = new Map<IDBValidKey, unknown>()
  const db = {
    createObjectStore() {
      return {}
    },
    transaction() {
      const tx = {
        objectStore() {
          return {
            put(value: unknown, key: IDBValidKey) {
              values.set(key, value)
            },
            get(key: IDBValidKey) {
              const req = createRequest<unknown>()
              queueMicrotask(() => {
                Object.defineProperty(req, 'result', { value: values.get(key), configurable: true })
                req.onsuccess?.(new Event('success'))
              })
              return req
            },
            delete(key: IDBValidKey) {
              values.delete(key)
            },
            openKeyCursor() {
              const req = createRequest<IDBCursor | null>()
              const keys = Array.from(values.keys())
              let index = 0

              const advance = () => {
                const key = keys[index++]
                const cursor = key === undefined
                  ? null
                  : {
                      key,
                      continue: () => queueMicrotask(advance),
                    }
                Object.defineProperty(req, 'result', { value: cursor, configurable: true })
                req.onsuccess?.(new Event('success'))
                if (!cursor) tx.oncomplete?.(new Event('complete'))
              }

              queueMicrotask(advance)
              return req
            },
          }
        },
        oncomplete: null as Listener | null,
        onerror: null as Listener | null,
        error: null,
      }

      queueMicrotask(() => tx.oncomplete?.(new Event('complete')))
      return tx
    },
  }

  return {
    open() {
      const req = createRequest<IDBDatabase>()
      queueMicrotask(() => {
        Object.defineProperty(req, 'result', { value: db, configurable: true })
        req.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        req.onsuccess?.(new Event('success'))
      })
      return req
    },
  } as IDBFactory
}

const fakeWindow = new FakeWindow()
const fakeDocument = new FakeDocument()

Object.assign(globalThis, {
  window: fakeWindow,
  document: fakeDocument,
  indexedDB: createFakeIndexedDb(),
  localStorage: new FakeStorage(),
  sessionStorage: new FakeStorage(),
  CustomEvent: globalThis.CustomEvent ?? FakeCustomEvent,
  fetch: async () => new Response(null, { status: 204 }),
})

async function createActivePrivateKey(): Promise<CryptoKey> {
  const keyPair = await generateKeyPair()
  const encrypted = await encryptPrivateKey(keyPair.privateKey, 'correct horse battery staple')
  return decryptPrivateKey(encrypted, 'correct horse battery staple')
}

test.beforeEach(async () => {
  fakeWindow.timeoutCallback = null
  fakeDocument.visibilityState = 'visible'
  await clearActivePrivateKeys()
})

test('active private key is cleared after browser inactivity', async () => {
  const privateKey = await createActivePrivateKey()
  await storeActivePrivateKey('user-1', privateKey)

  fakeWindow.timeoutCallback?.()

  assert.equal(await loadActivePrivateKey('user-1'), undefined)
})

test('active private key is cleared when the page is hidden', async () => {
  const privateKey = await createActivePrivateKey()
  await storeActivePrivateKey('user-1', privateKey)

  fakeDocument.visibilityState = 'hidden'
  fakeDocument.dispatchEvent(new Event('visibilitychange'))

  assert.equal(await loadActivePrivateKey('user-1'), undefined)
})

test('active private key is cleared on pagehide', async () => {
  const privateKey = await createActivePrivateKey()
  await storeActivePrivateKey('user-1', privateKey)

  fakeWindow.dispatchEvent(new Event('pagehide'))

  assert.equal(await loadActivePrivateKey('user-1'), undefined)
})

test('active private key is cleared on logout', async () => {
  const { logout, saveTokens } = await import('../api/auth.ts')
  const privateKey = await createActivePrivateKey()
  await storeActivePrivateKey('user-1', privateKey)
  saveTokens({ access_token: 'access-token', expires_in: 3600 })

  await logout()

  assert.equal(await loadActivePrivateKey('user-1'), undefined)
})

test('active private key is cleared when a different user is loaded', async () => {
  const privateKey = await createActivePrivateKey()
  await storeActivePrivateKey('user-1', privateKey)

  assert.equal(await loadActivePrivateKey('user-2'), undefined)
  assert.equal(await loadActivePrivateKey('user-1'), undefined)
})
