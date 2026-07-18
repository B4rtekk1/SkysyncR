import assert from 'node:assert/strict'
import test from 'node:test'
import { formatBytes, formatRelative, isMarkdownFile, kindFromFile, scramble } from './fileUtils.ts'

test('kindFromFile prefers MIME families for common media files', () => {
  assert.equal(kindFromFile('download.bin', 'image/png'), 'image')
  assert.equal(kindFromFile('download.bin', 'video/mp4'), 'video')
  assert.equal(kindFromFile('download.bin', 'audio/mpeg'), 'audio')
})

test('kindFromFile recognizes office, archive and code extensions', () => {
  assert.equal(kindFromFile('budget.xlsx', null), 'sheet')
  assert.equal(kindFromFile('deck.pptx', null), 'presentation')
  assert.equal(kindFromFile('letter.docx', null), 'document')
  assert.equal(kindFromFile('backup.tar', null), 'archive')
  assert.equal(kindFromFile('config.yaml', null), 'code')
})

test('kindFromFile treats text source files as code but plain text as text', () => {
  assert.equal(kindFromFile('readme.txt', 'text/plain'), 'text')
  assert.equal(kindFromFile('main.ts', 'text/plain'), 'code')
  assert.equal(kindFromFile('notes.md', 'text/markdown'), 'text')
})

test('isMarkdownFile accepts markdown MIME types and extensions', () => {
  assert.equal(isMarkdownFile('notes.txt', 'text/markdown'), true)
  assert.equal(isMarkdownFile('notes.markdown', null), true)
  assert.equal(isMarkdownFile('notes.txt', 'text/plain'), false)
})

test('formatBytes uses the smallest readable unit', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB')
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB')
})

test('formatRelative covers recent minute, hour and day windows', () => {
  const originalNow = Date.now
  Date.now = () => new Date('2026-07-18T12:00:00Z').getTime()

  try {
    assert.equal(formatRelative('2026-07-18T12:00:00Z'), 'Just now')
    assert.equal(formatRelative('2026-07-18T11:30:00Z'), '30 min ago')
    assert.equal(formatRelative('2026-07-18T09:00:00Z'), '3 hours ago')
    assert.equal(formatRelative('2026-07-16T12:00:00Z'), '2 days ago')
  } finally {
    Date.now = originalNow
  }
})

test('scramble preserves dots and keeps output length stable', () => {
  const value = scramble('file.name')
  assert.equal(value.length, 'file.name'.length)
  assert.equal(value[4], '.')
})
