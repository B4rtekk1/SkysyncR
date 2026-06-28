import type { EncryptedPrivateKey } from './keys'

const DB_NAME = 'skysyncr-vault'
const STORE_NAME = 'keys'

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

/** Zapisuje zaszyfrowany klucz prywatny lokalnie w przeglądarce. */
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

/** Odczytuje zaszyfrowany klucz prywatny (np. przy logowaniu). */
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
