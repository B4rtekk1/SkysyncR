
function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const ENCRYPTED_PRIVATE_KEY_VERSION = 1
const WRAPPING_KDF = 'PBKDF2'
const WRAPPING_KDF_HASH = 'SHA-256'
const WRAPPING_KDF_ITERATIONS = 250_000
const WRAPPING_ALGORITHM = 'AES-GCM'
const WRAPPING_ALGORITHM_LENGTH = 256

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
  iterations: number,
  hash: string,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    WRAPPING_KDF,
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: WRAPPING_KDF, salt: salt as BufferSource, iterations, hash },
    keyMaterial,
    { name: WRAPPING_ALGORITHM, length: WRAPPING_ALGORITHM_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface EncryptedPrivateKey {
  ciphertext: string
  version?: number
  kdf?: {
    name: string
    hash: string
    iterations: number
    salt: string
  }
  algorithm?: {
    name: string
    length: number
    iv: string
  }
  salt?: string
  iv?: string
}

type PrivateKeyEncryptionParams = {
  salt: string
  iv: string
  iterations: number
  hash: string
  algorithm: string
}

function getPrivateKeyEncryptionParams(encrypted: EncryptedPrivateKey): PrivateKeyEncryptionParams {
  if (encrypted.version === undefined) {
    if (!encrypted.salt || !encrypted.iv) {
      throw new Error('Invalid legacy encrypted private key format.')
    }

    return {
      salt: encrypted.salt,
      iv: encrypted.iv,
      iterations: WRAPPING_KDF_ITERATIONS,
      hash: WRAPPING_KDF_HASH,
      algorithm: WRAPPING_ALGORITHM,
    }
  }

  if (encrypted.version !== ENCRYPTED_PRIVATE_KEY_VERSION) {
    throw new Error(`Unsupported encrypted private key version: ${encrypted.version}.`)
  }

  if (
    encrypted.kdf?.name !== WRAPPING_KDF ||
    encrypted.kdf.hash !== WRAPPING_KDF_HASH ||
    encrypted.kdf.iterations <= 0
  ) {
    throw new Error('Unsupported encrypted private key KDF parameters.')
  }

  if (
    encrypted.algorithm?.name !== WRAPPING_ALGORITHM ||
    encrypted.algorithm.length !== WRAPPING_ALGORITHM_LENGTH
  ) {
    throw new Error('Unsupported encrypted private key algorithm parameters.')
  }

  return {
    salt: encrypted.kdf.salt,
    iv: encrypted.algorithm.iv,
    iterations: encrypted.kdf.iterations,
    hash: encrypted.kdf.hash,
    algorithm: encrypted.algorithm.name,
  }
}

export async function encryptPrivateKey(
  privateKey: CryptoKey,
  password: string,
): Promise<EncryptedPrivateKey> {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKey = await deriveWrappingKey(password, salt, WRAPPING_KDF_ITERATIONS, WRAPPING_KDF_HASH)

  const ciphertext = await crypto.subtle.encrypt(
    { name: WRAPPING_ALGORITHM, iv: iv as BufferSource },
    wrappingKey,
    exported,
  )

  return {
    version: ENCRYPTED_PRIVATE_KEY_VERSION,
    kdf: {
      name: WRAPPING_KDF,
      hash: WRAPPING_KDF_HASH,
      iterations: WRAPPING_KDF_ITERATIONS,
      salt: bufferToBase64(salt),
    },
    algorithm: {
      name: WRAPPING_ALGORITHM,
      length: WRAPPING_ALGORITHM_LENGTH,
      iv: bufferToBase64(iv),
    },
    ciphertext: bufferToBase64(ciphertext),
  }
}

export async function decryptPrivateKey(
  encrypted: EncryptedPrivateKey,
  password: string,
  extractable = false,
): Promise<CryptoKey> {
  const params = getPrivateKeyEncryptionParams(encrypted)
  const salt = new Uint8Array(base64ToBuffer(params.salt))
  const iv = new Uint8Array(base64ToBuffer(params.iv))
  const wrappingKey = await deriveWrappingKey(password, salt, params.iterations, params.hash)

  const decrypted = await crypto.subtle.decrypt(
    { name: params.algorithm, iv: iv as BufferSource },
    wrappingKey,
    base64ToBuffer(encrypted.ciphertext) as BufferSource,
  )

  return crypto.subtle.importKey(
    'pkcs8',
    decrypted,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    extractable,
    ['decrypt'],
  )
}
