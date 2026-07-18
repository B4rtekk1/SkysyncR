import assert from 'node:assert/strict'
import test from 'node:test'
import { generateFileKey, unwrapFileKeyForUser, wrapFileKeyForUser } from './fileEncryption.ts'
import { decryptPrivateKey, encryptPrivateKey, exportPublicKey, generateKeyPair } from './keys.ts'

test('private keys decrypt only with the original password', async () => {
  const keyPair = await generateKeyPair()
  const encrypted = await encryptPrivateKey(keyPair.privateKey, 'correct horse battery staple')

  assert.equal(encrypted.version, 1)
  assert.deepEqual(encrypted.kdf, {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 250_000,
    salt: encrypted.kdf?.salt,
  })
  assert.deepEqual(encrypted.algorithm, {
    name: 'AES-GCM',
    length: 256,
    iv: encrypted.algorithm?.iv,
  })

  const decrypted = await decryptPrivateKey(encrypted, 'correct horse battery staple')
  assert.equal(decrypted.type, 'private')

  await assert.rejects(() => decryptPrivateKey(encrypted, 'wrong password'))
})

test('legacy encrypted private key records remain decryptable', async () => {
  const keyPair = await generateKeyPair()
  const encrypted = await encryptPrivateKey(keyPair.privateKey, 'correct horse battery staple')

  const legacyEncrypted = {
    ciphertext: encrypted.ciphertext,
    salt: encrypted.kdf?.salt ?? '',
    iv: encrypted.algorithm?.iv ?? '',
  }

  const decrypted = await decryptPrivateKey(legacyEncrypted, 'correct horse battery staple')
  assert.equal(decrypted.type, 'private')
})

test('file keys can be wrapped for a user public key and unwrapped with the private key', async () => {
  const keyPair = await generateKeyPair()
  const fileKey = await generateFileKey()
  const publicKey = await exportPublicKey(keyPair.publicKey)

  const wrapped = await wrapFileKeyForUser(fileKey, publicKey)
  const unwrapped = await unwrapFileKeyForUser(btoa(String.fromCharCode(...new Uint8Array(wrapped))), keyPair.privateKey)

  const sample = new TextEncoder().encode('encrypted sample')
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, fileKey, sample)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, unwrapped, ciphertext)

  assert.equal(new TextDecoder().decode(plaintext), 'encrypted sample')
})
