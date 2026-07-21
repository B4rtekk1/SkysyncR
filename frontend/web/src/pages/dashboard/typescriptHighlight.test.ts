import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightTypeScript } from './typescriptHighlight.ts'

test('highlightTypeScript marks core typescript syntax tokens', () => {
  const tokens = highlightTypeScript('@sealed\nexport class User {\n  greet(name: string): string { return `Hi ${name}` }\n}\n')

  assert.deepEqual(
    tokens.filter((token) => token.type !== 'plain').map((token) => [token.type, token.text]),
    [
      ['decorator', '@sealed'],
      ['keyword', 'export'],
      ['keyword', 'class'],
      ['class-name', 'User'],
      ['operator', '{'],
      ['function', 'greet'],
      ['operator', '('],
      ['operator', ':'],
      ['builtin', 'string'],
      ['operator', '):'],
      ['builtin', 'string'],
      ['operator', '{'],
      ['keyword', 'return'],
      ['string', '`Hi ${name}`'],
      ['operator', '}'],
      ['operator', '}'],
    ],
  )
})

test('highlightTypeScript keeps block comments and quoted strings together', () => {
  const tokens = highlightTypeScript('const value = "/* not a comment */"\n/* line 1\nline 2 */')
  const stringToken = tokens.find((token) => token.type === 'string')
  const commentToken = tokens.find((token) => token.type === 'comment')

  assert.equal(stringToken?.text, '"/* not a comment */"')
  assert.equal(commentToken?.text, '/* line 1\nline 2 */')
})

test('highlightTypeScript marks functions, builtins and this references', () => {
  const tokens = highlightTypeScript('function make<T>(items: Array<T>) {\n  console.log(this.count ?? 0)\n}\n')

  assert.deepEqual(
    tokens.filter((token) => token.type !== 'plain').map((token) => [token.type, token.text]),
    [
      ['keyword', 'function'],
      ['function', 'make'],
      ['operator', '<'],
      ['class-name', 'T'],
      ['operator', '>('],
      ['operator', ':'],
      ['builtin', 'Array'],
      ['operator', '<'],
      ['class-name', 'T'],
      ['operator', '>)'],
      ['operator', '{'],
      ['builtin', 'console'],
      ['operator', '.'],
      ['function', 'log'],
      ['operator', '('],
      ['self', 'this'],
      ['operator', '.'],
      ['operator', '??'],
      ['number', '0'],
      ['operator', ')'],
      ['operator', '}'],
    ],
  )
})
