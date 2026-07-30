import assert from 'node:assert/strict'
import test from 'node:test'
import { createQrPath } from './qr.ts'

test('createQrPath returns a deterministic SVG path and viewBox for the same value', () => {
  const first = createQrPath('https://skysyncr.example/share/token')
  const second = createQrPath('https://skysyncr.example/share/token')

  assert.equal(first.viewBox, '0 0 49 49')
  assert.equal(first.path, second.path)
  assert.ok(first.path.startsWith('M4.08,4.5a0.42,0.42'))
  assert.ok(first.path.length > 1000)
})

test('createQrPath changes encoded modules when value changes', () => {
  assert.notEqual(createQrPath('one').path, createQrPath('two').path)
})

test('createQrPath supports share links with embedded file keys', () => {
  const value = `http://localhost:5173/share/${crypto.randomUUID()}#key=${'a'.repeat(43)}`

  assert.ok(createQrPath(value).path.length > 1000)
})

test('createQrPath rejects links that exceed the version capacity', () => {
  assert.throws(() => createQrPath('x'.repeat(135)), /QR link is too long/)
})
