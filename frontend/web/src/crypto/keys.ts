
function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', key)
  return bufferToBase64(exported)
}

async function deriveWrappingKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 250_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface EncryptedPrivateKey {
  ciphertext: string
  salt: string
  iv: string
}

export async function encryptPrivateKey(
  privateKey: CryptoKey,
  password: string,
): Promise<EncryptedPrivateKey> {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKey = await deriveWrappingKey(password, salt)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    wrappingKey,
    exported,
  )

  return {
    ciphertext: bufferToBase64(ciphertext),
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
  }
}

export async function decryptPrivateKey(
  encrypted: EncryptedPrivateKey,
  password: string,
): Promise<CryptoKey> {
  const salt = new Uint8Array(base64ToBuffer(encrypted.salt))
  const iv = new Uint8Array(base64ToBuffer(encrypted.iv))
  const wrappingKey = await deriveWrappingKey(password, salt)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    wrappingKey,
    base64ToBuffer(encrypted.ciphertext) as BufferSource,
  )

  return crypto.subtle.importKey(
    'pkcs8',
    decrypted,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt'],
  )
}
