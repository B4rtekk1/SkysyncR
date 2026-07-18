import type { EncryptedPrivateKey } from './keys'

const DB_NAME = 'skysyncr-vault'
const STORE_NAME = 'keys'
const ACTIVE_PRIVATE_KEY_PREFIX = 'active-private-key:'
const ACTIVE_PRIVATE_KEY_IDLE_TIMEOUT_MS = 15 * 60 * 1000
const ACTIVE_PRIVATE_KEY_CLEARED_EVENT = 'skysyncr:active-private-key-cleared'

type ActivePrivateKeySession = {
  userId: string
  privateKey: CryptoKey
}

let activePrivateKeySession: ActivePrivateKeySession | null = null
let idleTimeoutId: ReturnType<typeof setTimeout> | null = null
let lifecycleListenersInstalled = false

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function clearIdleTimeout() {
  if (!idleTimeoutId) return
  clearTimeout(idleTimeoutId)
  idleTimeoutId = null
}

function notifyActivePrivateKeyCleared(userId: string | null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(ACTIVE_PRIVATE_KEY_CLEARED_EVENT, {
      detail: { userId },
    }),
  )
}

function resetIdleTimeout() {
  clearIdleTimeout()
  if (!activePrivateKeySession || typeof window === 'undefined') return

  idleTimeoutId = window.setTimeout(() => {
    void clearActivePrivateKeys()
  }, ACTIVE_PRIVATE_KEY_IDLE_TIMEOUT_MS)
}

function handleUserActivity() {
  resetIdleTimeout()
}

function installLifecycleListeners() {
  if (lifecycleListenersInstalled || typeof window === 'undefined') return
  lifecycleListenersInstalled = true

  for (const eventName of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(eventName, handleUserActivity, { passive: true })
  }

  window.addEventListener('pagehide', () => void clearActivePrivateKeys())
  window.addEventListener('freeze', () => void clearActivePrivateKeys())
}

async function clearLegacyPersistedActivePrivateKeys(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.openKeyCursor()

    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return

      if (typeof cursor.key === 'string' && cursor.key.startsWith(ACTIVE_PRIVATE_KEY_PREFIX)) {
        store.delete(cursor.key)
      }

      cursor.continue()
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function onActivePrivateKeyCleared(
  listener: (userId: string | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const handler = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail as { userId?: string | null } : null
    listener(detail?.userId ?? null)
  }

  window.addEventListener(ACTIVE_PRIVATE_KEY_CLEARED_EVENT, handler)
  return () => window.removeEventListener(ACTIVE_PRIVATE_KEY_CLEARED_EVENT, handler)
}

export async function storeEncryptedPrivateKey(
  userId: string,
  data: EncryptedPrivateKey,
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, userId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadEncryptedPrivateKey(
  userId: string,
): Promise<EncryptedPrivateKey | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(userId)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storeActivePrivateKey(
  userId: string,
  privateKey: CryptoKey,
): Promise<void> {
  if (privateKey.extractable) {
    throw new Error('Active private keys must be imported as non-extractable.')
  }

  activePrivateKeySession = { userId, privateKey }
  installLifecycleListeners()
  resetIdleTimeout()
  await clearLegacyPersistedActivePrivateKeys().catch(() => {
    // Legacy cleanup is best-effort; the active key itself is memory-only.
  })
}

export async function loadActivePrivateKey(
  userId: string,
): Promise<CryptoKey | undefined> {
  if (activePrivateKeySession?.userId !== userId) return undefined
  resetIdleTimeout()
  return activePrivateKeySession.privateKey
}

export async function clearActivePrivateKeys(): Promise<void> {
  const clearedUserId = activePrivateKeySession?.userId ?? null
  activePrivateKeySession = null
  clearIdleTimeout()
  notifyActivePrivateKeyCleared(clearedUserId)
  await clearLegacyPersistedActivePrivateKeys().catch(() => {
    // Do not let IndexedDB cleanup failures keep a key alive in memory.
  })
}
