import assert from 'node:assert/strict'
import test from 'node:test'
import { checkTypeScriptTypes } from './typescriptTypeCheck.ts'

test('checkTypeScriptTypes reports annotated variable literal mismatches', () => {
  const diagnostics = checkTypeScriptTypes('const count: number = "one"\nconst name: string = "Ada"\n')

  assert.deepEqual(diagnostics, [
    {
      column: 7,
      line: 1,
      message: 'Variable "count" expects number, but the static checker inferred string.',
      severity: 'warning',
    },
  ])
})

test('checkTypeScriptTypes reports incompatible parameter defaults', () => {
  const diagnostics = checkTypeScriptTypes('function fetch(limit: number = "10", active: boolean = true) {\n  return undefined\n}\n')

  assert.deepEqual(diagnostics, [
    {
      column: 16,
      line: 1,
      message: 'Parameter "limit" expects number, but the static checker inferred string.',
      severity: 'warning',
    },
  ])
})

test('checkTypeScriptTypes reports simple return type mismatches', () => {
  const diagnostics = checkTypeScriptTypes('function size(): number {\n  return "large"\n}\n')

  assert.deepEqual(diagnostics, [
    {
      column: 3,
      line: 2,
      message: 'Function "size" return expects number, but the static checker inferred string.',
      severity: 'warning',
    },
  ])
})

test('checkTypeScriptTypes accepts unions and arrays', () => {
  const diagnostics = checkTypeScriptTypes('const values: string[] = []\nfunction maybe(): string | null {\n  return null\n}\n')

  assert.deepEqual(diagnostics, [])
})

test('checkTypeScriptTypes reports assignments that conflict with annotated parameters', () => {
  const diagnostics = checkTypeScriptTypes('function fun(x: number = 8) {\n  x = "qwerty"\n}\n')

  assert.deepEqual(diagnostics, [
    {
      column: 3,
      line: 2,
      message: 'Variable "x" expects number, but the static checker inferred string.',
      severity: 'warning',
    },
  ])
})
