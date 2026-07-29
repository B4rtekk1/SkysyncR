import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightCpp, highlightCppLine, type CudaHighlightState } from './cudaHighlight.ts'

test('highlightCpp marks core C++ syntax tokens', () => {
  const tokens = highlightCpp('#include <vector>\nclass Solver {\npublic:\n  size_t run(const std::vector<int>& values) { return values.size(); }\n};\n')

  assert.deepEqual(
    tokens.filter((token) => token.type !== 'plain').map((token) => [token.type, token.text]),
    [
      ['decorator', '#include'],
      ['operator', '<'],
      ['operator', '>'],
      ['keyword', 'class'],
      ['class-name', 'Solver'],
      ['operator', '{'],
      ['keyword', 'public'],
      ['operator', ':'],
      ['builtin', 'size_t'],
      ['function', 'run'],
      ['operator', '('],
      ['keyword', 'const'],
      ['builtin', 'std'],
      ['operator', '::'],
      ['operator', '<'],
      ['keyword', 'int'],
      ['operator', '>&'],
      ['operator', ')'],
      ['operator', '{'],
      ['keyword', 'return'],
      ['operator', '.'],
      ['function', 'size'],
      ['operator', '();'],
      ['operator', '}'],
      ['operator', '};'],
    ],
  )
})

test('highlightCpp keeps block comments across rendered lines', () => {
  const lines = ['/*', ' * @ brief comment', ' */', 'int main() { return 0; }']
  let state: CudaHighlightState = { inBlockComment: false }
  const tokens = lines.flatMap((line) => {
    const result = highlightCppLine(line, state)
    state = result.state
    return result.tokens
  })

  assert.deepEqual(
    tokens.filter((token) => token.type === 'magic').map((token) => token.text),
    ['@ brief'],
  )
  assert.equal(tokens.find((token) => token.text === 'main')?.type, 'function')
})
