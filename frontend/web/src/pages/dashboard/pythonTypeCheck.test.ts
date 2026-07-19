import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPythonTypes } from './pythonTypeCheck.ts'

test('checkPythonTypes reports annotated variable literal mismatches', () => {
  const diagnostics = checkPythonTypes('count: int = "one"\nname: str = "Ada"\n')

  assert.deepEqual(diagnostics, [
    {
      column: 1,
      line: 1,
      message: 'Variable "count" expects int, but the static checker inferred str.',
      severity: 'warning',
    },
  ])
})

test('checkPythonTypes reports incompatible parameter defaults', () => {
  const diagnostics = checkPythonTypes('def fetch(limit: int = "10", active: bool = True):\n    return None\n')

  assert.deepEqual(diagnostics, [
    {
      column: 11,
      line: 1,
      message: 'Parameter "limit" expects int, but the static checker inferred str.',
      severity: 'warning',
    },
  ])
})

test('checkPythonTypes reports simple return type mismatches', () => {
  const diagnostics = checkPythonTypes('def size() -> int:\n    return "large"\n')

  assert.deepEqual(diagnostics, [
    {
      column: 5,
      line: 2,
      message: 'Function "size" return expects int, but the static checker inferred str.',
      severity: 'warning',
    },
  ])
})

test('checkPythonTypes accepts compatible int to float and optional None', () => {
  const diagnostics = checkPythonTypes('ratio: float = 1\ndef maybe() -> Optional[str]:\n    return None\n')

  assert.deepEqual(diagnostics, [])
})

test('checkPythonTypes reports assignments that conflict with annotated parameters', () => {
  const diagnostics = checkPythonTypes('def fun(x: int = 8):\n\tx = "qwerty"\n')

  assert.deepEqual(diagnostics, [
    {
      column: 2,
      line: 2,
      message: 'Variable "x" expects int, but the static checker inferred str.',
      severity: 'warning',
    },
  ])
})

test('checkPythonTypes accepts assignments matching annotated parameters', () => {
  const diagnostics = checkPythonTypes('def fun(x: int = 8):\n\tx = 9\n')

  assert.deepEqual(diagnostics, [])
})
