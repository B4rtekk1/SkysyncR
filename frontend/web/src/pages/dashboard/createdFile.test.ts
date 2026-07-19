import assert from 'node:assert/strict'
import test from 'node:test'

import { hasFileExtension, mimeTypeForCreatedFile } from './createdFile.ts'

test('detects Python MIME type for created files', () => {
    assert.equal(mimeTypeForCreatedFile('script.py'), 'text/x-python')
    assert.equal(mimeTypeForCreatedFile('types.pyi'), 'text/x-python')
    assert.equal(mimeTypeForCreatedFile('launcher.pyw'), 'text/x-python')
})

test('detects common text-like MIME types for created files', () => {
    assert.equal(mimeTypeForCreatedFile('README.markdown'), 'text/markdown')
    assert.equal(mimeTypeForCreatedFile('data.CSV'), 'text/csv')
    assert.equal(mimeTypeForCreatedFile('manifest.json'), 'application/json')
    assert.equal(mimeTypeForCreatedFile('index.HTML'), 'text/html')
    assert.equal(mimeTypeForCreatedFile('styles.css'), 'text/css')
    assert.equal(mimeTypeForCreatedFile('module.mjs'), 'text/javascript')
    assert.equal(mimeTypeForCreatedFile('notes.unknown'), 'text/plain')
})

test('requires a real file extension before creating a file', () => {
    assert.equal(hasFileExtension('script.py'), true)
    assert.equal(hasFileExtension('archive.tar.gz'), true)
    assert.equal(hasFileExtension('script'), false)
    assert.equal(hasFileExtension('script.'), false)
    assert.equal(hasFileExtension('.env'), false)
    assert.equal(hasFileExtension('folder/name'), false)
    assert.equal(hasFileExtension('folder/name.'), false)
})
