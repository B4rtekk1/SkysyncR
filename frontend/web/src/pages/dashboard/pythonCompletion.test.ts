import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPythonCompletion, getPythonKeywordCompletion, getPythonVariableCompletions } from './pythonCompletion.ts'

test('getPythonKeywordCompletion suggests keywords for the current prefix', () => {
  const completion = getPythonKeywordCompletion('ret', 3)

  assert.equal(completion?.prefix, 'ret')
  assert.equal(completion?.start, 0)
  assert.equal(completion?.end, 3)
  assert.deepEqual(completion?.items, [{ label: 'return', type: 'keyword' }])
})

test('getPythonKeywordCompletion ignores exact keyword matches and non-word carets', () => {
  assert.equal(getPythonKeywordCompletion('return', 6), null)
  assert.equal(getPythonKeywordCompletion('return ', 7), null)
})

test('applyPythonCompletion replaces only the active prefix', () => {
  const completion = getPythonKeywordCompletion('if value:\n    ret', 17)

  assert.equal(
    completion && applyPythonCompletion('if value:\n    ret', completion, { label: 'return', type: 'keyword' }),
    'if value:\n    return',
  )
})

test('getPythonVariableCompletions suggests local names before the caret', () => {
  const source = 'user_name = "Ada"\nfor user_id in users:\n    us'

  assert.deepEqual(getPythonVariableCompletions(source, source.length - 2, 'us'), ['user_id', 'user_name'])
})

test('getPythonKeywordCompletion includes variables before keywords', () => {
  const source = 'def greet(user_name, count=1):\n    user'
  const completion = getPythonKeywordCompletion(source, source.length)

  assert.deepEqual(completion?.items.slice(0, 1), [{ label: 'user_name', type: 'variable' }])
})

test('getPythonVariableCompletions suggests function arguments with annotations and stars', () => {
  const source = 'async def run(user_id: int, count=1, *items, **options):\n\tco'

  assert.deepEqual(getPythonVariableCompletions(source, source.length - 2, 'co'), ['count'])
  assert.deepEqual(getPythonVariableCompletions(source, source.length - 2, 'it'), ['items'])
  assert.deepEqual(getPythonVariableCompletions(source, source.length - 2, 'op'), ['options'])
  assert.deepEqual(getPythonVariableCompletions(source, source.length - 2, 'user'), ['user_id'])
})

test('getPythonVariableCompletions tolerates typed argument order while editing', () => {
  const source = 'def function(int xy_value):\n\txy_'

  assert.deepEqual(getPythonVariableCompletions(source, source.length - 3, 'xy_'), ['xy_value'])
})
