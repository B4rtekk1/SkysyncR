import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightCuda, highlightCudaLine, type CudaHighlightState } from './cudaHighlight.ts'

test('highlightCuda marks core CUDA syntax tokens', () => {
  const tokens = highlightCuda('__global__ void add(float* out, const float* a) {\n  int i = blockIdx.x * blockDim.x + threadIdx.x;\n}\n')

  assert.deepEqual(
    tokens.filter((token) => token.type !== 'plain').map((token) => [token.type, token.text]),
    [
      ['decorator', '__global__'],
      ['keyword', 'void'],
      ['function', 'add'],
      ['operator', '('],
      ['keyword', 'float'],
      ['operator', '*'],
      ['operator', ','],
      ['keyword', 'const'],
      ['keyword', 'float'],
      ['operator', '*'],
      ['operator', ')'],
      ['operator', '{'],
      ['keyword', 'int'],
      ['operator', '='],
      ['builtin', 'blockIdx'],
      ['operator', '.'],
      ['operator', '*'],
      ['builtin', 'blockDim'],
      ['operator', '.'],
      ['operator', '+'],
      ['builtin', 'threadIdx'],
      ['operator', '.'],
      ['operator', ';'],
      ['operator', '}'],
    ],
  )
})

test('highlightCuda keeps comments and strings together', () => {
  const tokens = highlightCuda('#include <cuda_runtime.h>\nconst char* value = "/* not a comment */";\n/* line 1\nline 2 */')
  const directiveToken = tokens.find((token) => token.type === 'decorator')
  const stringToken = tokens.find((token) => token.type === 'string')
  const commentToken = tokens.find((token) => token.type === 'comment')

  assert.equal(directiveToken?.text, '#include')
  assert.equal(stringToken?.text, '"/* not a comment */"')
  assert.equal(commentToken?.text, '/* line 1\nline 2 */')
})

test('highlightCuda marks Doxygen-style block documentation across rendered lines', () => {
  const lines = [
    '/**',
    '* @ file rmsnorm.cu',
    ' * @ brief CUDA implementation of Root Mean Square Layer Normalization.',
    ' *',
    ' */',
    '__global__ void rmsnorm() {}',
  ]
  let state: CudaHighlightState = { inBlockComment: false }
  const tokens = lines.flatMap((line) => {
    const result = highlightCudaLine(line, state)
    state = result.state
    return result.tokens
  })

  assert.deepEqual(
    tokens.filter((token) => token.type === 'magic').map((token) => token.text),
    ['@ file', '@ brief'],
  )
  assert.equal(tokens.find((token) => token.text.includes('CUDA implementation'))?.type, 'comment')
  assert.equal(tokens.find((token) => token.text === '__global__')?.type, 'decorator')
})
