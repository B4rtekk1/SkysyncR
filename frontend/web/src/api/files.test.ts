import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyBlobChecksum } from './filesIntegrity.ts'

test('verifyBlobChecksum accepts a matching SHA-256 checksum', async () => {
  const result = await verifyBlobChecksum(
    new Blob(['hello']),
    '2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824',
  )

  assert.deepEqual(result, {
    status: 'verified',
    expectedChecksum: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    actualChecksum: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  })
})

test('verifyBlobChecksum rejects mismatched SHA-256 checksums', async () => {
  await assert.rejects(
    () => verifyBlobChecksum(new Blob(['hello']), '0'.repeat(64)),
    /failed integrity verification/,
  )
})

test('verifyBlobChecksum rejects malformed checksum headers', async () => {
  await assert.rejects(
    () => verifyBlobChecksum(new Blob(['hello']), 'not-a-sha256'),
    /invalid integrity checksum/,
  )
})

test('verifyBlobChecksum reports missing checksum headers', async () => {
  const result = await verifyBlobChecksum(new Blob(['hello']), null)

  assert.deepEqual(result, {
    status: 'missing',
    expectedChecksum: null,
    actualChecksum: null,
  })
})
