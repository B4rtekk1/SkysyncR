import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTypeScriptCompletion,
  getTypeScriptKeywordCompletion,
  getTypeScriptVariableCompletions,
} from './typescriptCompletion.ts'

test('getTypeScriptKeywordCompletion suggests keywords for the current prefix', () => {
  const completion = getTypeScriptKeywordCompletion('ret', 3)

  assert.equal(completion?.prefix, 'ret')
  assert.equal(completion?.start, 0)
  assert.equal(completion?.end, 3)
  assert.deepEqual(completion?.items, [{ label: 'return', type: 'keyword' }])
})

test('getTypeScriptKeywordCompletion ignores exact keyword matches and non-word carets', () => {
  assert.equal(getTypeScriptKeywordCompletion('return', 6), null)
  assert.equal(getTypeScriptKeywordCompletion('return ', 7), null)
})

test('applyTypeScriptCompletion replaces only the active prefix', () => {
  const completion = getTypeScriptKeywordCompletion('if (value) {\n  ret', 18)

  assert.equal(
    completion && applyTypeScriptCompletion('if (value) {\n  ret', completion, { label: 'return', type: 'keyword' }),
    'if (value) {\n  return',
  )
})

test('getTypeScriptVariableCompletions suggests local names before the caret', () => {
  const source = 'const userName = "Ada"\nfor (const userId of users) {\n  us'

  assert.deepEqual(getTypeScriptVariableCompletions(source, source.length - 2, 'us'), ['userId', 'userName'])
})

test('getTypeScriptKeywordCompletion includes variables before keywords', () => {
  const source = 'function greet(userName: string, count = 1) {\n  user'
  const completion = getTypeScriptKeywordCompletion(source, source.length)

  assert.deepEqual(completion?.items.slice(0, 1), [{ label: 'userName', type: 'variable' }])
})

test('getTypeScriptVariableCompletions suggests function arguments and rest parameters', () => {
  const source = 'async function run(userId: string, count = 1, ...items: string[]) {\n  co'

  assert.deepEqual(getTypeScriptVariableCompletions(source, source.length - 2, 'co'), ['count'])
  assert.deepEqual(getTypeScriptVariableCompletions(source, source.length - 2, 'it'), ['items'])
  assert.deepEqual(getTypeScriptVariableCompletions(source, source.length - 2, 'user'), ['userId'])
})
