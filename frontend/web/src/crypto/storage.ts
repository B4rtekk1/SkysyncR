import type {EncryptedPrivatekey} from "./keys.ts";

const DB_NAME = "skysync-vault";
const STORE_NAME = "keys";

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME)
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    })
}

export async function storeEncryptedPrivateKey(userId: string, key: EncryptedPrivatekey): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(key, userId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    })
}

export async function loadEncryptedPrivateKey(userId: string): Promise<EncryptedPrivatekey | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(userId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    })
}