export async function generateFileKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt', 'decrypt'])
}

export async function encryptFile(
    file: File,
    key: CryptoKey,
): Promise<{ciphertext: ArrayBuffer; nonce: Uint8Array}> {
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = await file.arrayBuffer()
    const ciphertext = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv: nonce},
        key,
        plaintext,
    )
    return {ciphertext, nonce}
}

export async function exportRawKey(key: CryptoKey): Promise<ArrayBuffer> {
    return crypto.subtle.exportKey('raw', key)
}

export async function importRsaPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'spki',
        base64ToBuffer(publicKeyBase64) as BufferSource,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt'],
    )
}

export async function wrapFileKeyForUser(key: CryptoKey, publicKeyBase64: string): Promise<ArrayBuffer> {
    const rawKey = await exportRawKey(key)
    const publicKey = await importRsaPublicKey(publicKeyBase64)
    return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey)
}

export async function unwrapFileKeyForUser(
    encryptedKeyBase64: string,
    privateKey: CryptoKey,
): Promise<CryptoKey> {
    const rawKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        base64ToBuffer(encryptedKeyBase64) as BufferSource,
    )

    return crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )
}

export async function decryptFile(
    encryptedBlob: Blob,
    key: CryptoKey,
    nonceBase64: string,
    mimeType: string | null,
): Promise<Blob> {
    const ciphertext = await encryptedBlob.arrayBuffer()
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBuffer(nonceBase64) as BufferSource },
        key,
        ciphertext,
    )

    return new Blob([plaintext], { type: mimeType || 'application/octet-stream' })
}

export async function encryptText(
    value: string,
    key: CryptoKey,
): Promise<{ ciphertext: ArrayBuffer; nonce: Uint8Array }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(value)
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        plaintext,
    )

    return { ciphertext, nonce }
}

export function encryptedTextEnvelope(ciphertext: ArrayBuffer, nonce: Uint8Array): string {
    return `aes-gcm:v1:${arrayBufferToBase64(nonce)}:${arrayBufferToBase64(ciphertext)}`
}

export async function encryptTextEnvelope(value: string, key: CryptoKey): Promise<string> {
    const { ciphertext, nonce } = await encryptText(value, key)
    return encryptedTextEnvelope(ciphertext, nonce)
}

export function isEncryptedTextEnvelope(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.startsWith('aes-gcm:v1:')
}

export async function decryptTextEnvelope(value: string, key: CryptoKey): Promise<string> {
    const [, , nonce, ciphertext] = value.split(':')
    if (!nonce || !ciphertext) {
        throw new Error('Invalid encrypted text envelope')
    }

    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBuffer(nonce) as BufferSource },
        key,
        base64ToBuffer(ciphertext) as BufferSource,
    )

    return new TextDecoder().decode(plaintext)
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}
