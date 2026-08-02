import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decryptFileStream,
  decryptTextEnvelope,
  encryptedFileFormatNonce,
  encryptFileStream,
  encryptTextEnvelope,
  fileContentKeyFingerprint,
  generateFileKey,
  isChunkedFileNonce,
  streamToBlob,
} from './fileEncryption.ts'

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
}

test('text envelopes decrypt with the original key and reject a different key', async () => {
  const key = await generateFileKey()
  const otherKey = await generateFileKey()
  const envelope = await encryptTextEnvelope('private note', key)

  assert.equal(await decryptTextEnvelope(envelope, key), 'private note')
  await assert.rejects(() => decryptTextEnvelope(envelope, otherKey))
})

test('chunked file encryption streams round trip file contents', async () => {
  const key = await generateFileKey()
  const plaintext = 'chunked file content'.repeat(10_000)
  const encrypted = await streamToBlob(
    encryptFileStream(new Blob([plaintext], { type: 'text/plain' }), key),
    'application/octet-stream',
  )
  const nonce = toBase64(encryptedFileFormatNonce())

  assert.equal(isChunkedFileNonce(nonce), true)

  const decrypted = await streamToBlob(decryptFileStream(encrypted, key, nonce), 'text/plain')
  assert.equal(await decrypted.text(), plaintext)
})

test('chunked file decryption rejects non-stream nonce markers', async () => {
  const key = await generateFileKey()
  const nonce = toBase64(new TextEncoder().encode('not-skysync'))

  assert.equal(isChunkedFileNonce(nonce), false)
  assert.throws(() => decryptFileStream(new Blob(), key, nonce))
})

test('file content key fingerprints are stable and distinguish rotated keys', async () => {
  const key = await generateFileKey()
  const rotatedKey = await generateFileKey()

  assert.match(await fileContentKeyFingerprint(key), /^[a-f0-9]{64}$/)
  assert.equal(await fileContentKeyFingerprint(key), await fileContentKeyFingerprint(key))
  assert.notEqual(await fileContentKeyFingerprint(key), await fileContentKeyFingerprint(rotatedKey))
})
