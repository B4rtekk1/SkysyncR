import assert from 'node:assert/strict'
import test from 'node:test'

import { hasFileExtension, mimeTypeForCreatedFile } from './createdFile.ts'

test('detects Python MIME type for created files', () => {
    assert.equal(mimeTypeForCreatedFile('script.py'), 'text/x-python')
    assert.equal(mimeTypeForCreatedFile('types.pyi'), 'text/x-python')
    assert.equal(mimeTypeForCreatedFile('launcher.pyw'), 'text/x-python')
})

test('requires a real file extension before creating a file', () => {
    assert.equal(hasFileExtension('script.py'), true)
    assert.equal(hasFileExtension('script'), false)
    assert.equal(hasFileExtension('script.'), false)
})
