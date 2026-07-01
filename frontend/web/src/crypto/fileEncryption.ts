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