export async function generateFileKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt', 'decrypt'])
}

const FILE_FORMAT_V2 = 'skysyncr-file:v2'
const FILE_FORMAT_V2_BYTES = new TextEncoder().encode(FILE_FORMAT_V2)
const FILE_STREAM_MAGIC = new TextEncoder().encode('SSRFENC2')
const FILE_CHUNK_SIZE = 4 * 1024 * 1024
const GCM_NONCE_BYTES = 12
const CHUNK_LENGTH_BYTES = 4

export function encryptedFileFormatNonce(): Uint8Array {
    return FILE_FORMAT_V2_BYTES
}

export function encryptFileStream(file: Blob, key: CryptoKey): ReadableStream<Uint8Array> {
    let headerSent = false
    let offset = 0

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (!headerSent) {
                headerSent = true
                controller.enqueue(FILE_STREAM_MAGIC)
                return
            }

            if (offset >= file.size) {
                controller.close()
                return
            }

            const value = new Uint8Array(await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer())
            offset += value.byteLength
            const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES))
            const ciphertext = new Uint8Array(
                await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, value),
            )
            const length = new Uint8Array(CHUNK_LENGTH_BYTES)
            new DataView(length.buffer).setUint32(0, ciphertext.byteLength, false)

            const framed = new Uint8Array(nonce.byteLength + length.byteLength + ciphertext.byteLength)
            framed.set(nonce, 0)
            framed.set(length, nonce.byteLength)
            framed.set(ciphertext, nonce.byteLength + length.byteLength)
            controller.enqueue(framed)
        },
    })
}

export async function exportRawKey(key: CryptoKey): Promise<ArrayBuffer> {
    return crypto.subtle.exportKey('raw', key)
}

export async function importRawFileKey(rawKey: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
    const keyBytes = rawKey instanceof Uint8Array
        ? new Uint8Array(rawKey).buffer as ArrayBuffer
        : rawKey

    return crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )
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

    return importRawFileKey(rawKey)
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

export function decryptFileStream(
    encryptedBlob: Blob,
    key: CryptoKey,
    nonceBase64: string,
): ReadableStream<Uint8Array> {
    if (new TextDecoder().decode(base64ToBuffer(nonceBase64)) !== FILE_FORMAT_V2) {
        throw new Error('Unsupported encrypted file stream')
    }

    const reader = encryptedBlob.stream().getReader()
    let buffer = new Uint8Array(0)
    let headerRead = false

    async function readMore(): Promise<boolean> {
        const { done, value } = await reader.read()
        if (done) return false

        const next = new Uint8Array(buffer.byteLength + value.byteLength)
        next.set(buffer, 0)
        next.set(value, buffer.byteLength)
        buffer = next
        return true
    }

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            while (!headerRead && buffer.byteLength < FILE_STREAM_MAGIC.byteLength) {
                if (!(await readMore())) break
            }

            if (!headerRead) {
                const header = buffer.slice(0, FILE_STREAM_MAGIC.byteLength)
                if (!bytesEqual(header, FILE_STREAM_MAGIC)) {
                    throw new Error('Invalid encrypted file stream')
                }
                buffer = buffer.slice(FILE_STREAM_MAGIC.byteLength)
                headerRead = true
            }

            while (buffer.byteLength < GCM_NONCE_BYTES + CHUNK_LENGTH_BYTES) {
                if (!(await readMore())) {
                    controller.close()
                    return
                }
            }

            const nonce = buffer.slice(0, GCM_NONCE_BYTES)
            const ciphertextLength = new DataView(
                buffer.buffer,
                buffer.byteOffset + GCM_NONCE_BYTES,
                CHUNK_LENGTH_BYTES,
            ).getUint32(0, false)
            const frameLength = GCM_NONCE_BYTES + CHUNK_LENGTH_BYTES + ciphertextLength

            while (buffer.byteLength < frameLength) {
                if (!(await readMore())) throw new Error('Truncated encrypted file stream')
            }

            const ciphertext = buffer.slice(GCM_NONCE_BYTES + CHUNK_LENGTH_BYTES, frameLength)
            buffer = buffer.slice(frameLength)
            const plaintext = new Uint8Array(
                await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
            )
            controller.enqueue(plaintext)
        },
        cancel() {
            void reader.cancel()
        },
    })
}

export function isChunkedFileNonce(nonceBase64: string): boolean {
    try {
        return new TextDecoder().decode(base64ToBuffer(nonceBase64)) === FILE_FORMAT_V2
    } catch {
        return false
    }
}

export async function streamToBlob(stream: ReadableStream<Uint8Array>, mimeType: string | null): Promise<Blob> {
    return new Response(stream).blob().then((blob) => blob.slice(0, blob.size, mimeType || 'application/octet-stream'))
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

export function arrayBufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
    return arrayBufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBuffer(base64Url: string): Uint8Array {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    return base64ToBuffer(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false
    return a.every((value, index) => value === b[index])
}
