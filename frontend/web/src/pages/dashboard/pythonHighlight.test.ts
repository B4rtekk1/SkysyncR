import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightPython } from './pythonHighlight.ts'

test('highlightPython marks core python syntax tokens', () => {
  const tokens = highlightPython('@route\ndef greet(self, name):\n    return f"Hi {name}"  # greeting\n')

  assert.deepEqual(
    tokens.filter((token) => token.type !== 'plain').map((token) => [token.type, token.text]),
    [
      ['decorator', '@route'],
      ['keyword', 'def'],
      ['function', 'greet'],
      ['operator', '('],
      ['self', 'self'],
      ['operator', ','],
      ['operator', '):'],
      ['keyword', 'return'],
      ['string', 'f"Hi {name}"'],
      ['comment', '# greeting'],
    ],
  )
})

test('highlightPython keeps triple quoted strings together', () => {
  const tokens = highlightPython('value = """line 1\nline 2"""\n')
  const stringToken = tokens.find((token) => token.type === 'string')

  assert.equal(stringToken?.text, '"""line 1\nline 2"""')
})

test('highlightPython marks vscode-like semantic tokens', () => {
  const tokens = highlightPython('class User:\n    def __init__(self):\n        print(len([1, 2]))\n')

  assert.deepEqual(
    tokens.filter((token) => token.type !== 'plain').map((token) => [token.type, token.text]),
    [
      ['keyword', 'class'],
      ['class-name', 'User'],
      ['operator', ':'],
      ['keyword', 'def'],
      ['function', '__init__'],
      ['operator', '('],
      ['self', 'self'],
      ['operator', '):'],
      ['builtin', 'print'],
      ['operator', '('],
      ['builtin', 'len'],
      ['operator', '(['],
      ['number', '1'],
      ['operator', ','],
      ['number', '2'],
      ['operator', ']))'],
    ],
  )
})
