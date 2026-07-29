export type CudaHighlightTokenType =
    | 'builtin'
    | 'class-name'
    | 'comment'
    | 'decorator'
    | 'function'
    | 'keyword'
    | 'magic'
    | 'number'
    | 'operator'
    | 'plain'
    | 'self'
    | 'string'

export type CudaHighlightToken = {
    text: string
    type: CudaHighlightTokenType
}

export type CudaHighlightState = {
    inBlockComment: boolean
}

export type CudaHighlightMode = 'cpp' | 'cuda'

const CUDA_KEYWORDS = new Set([
    'asm',
    'auto',
    'bool',
    'break',
    'case',
    'catch',
    'char',
    'class',
    'const',
    'constexpr',
    'consteval',
    'constinit',
    'const_cast',
    'continue',
    'co_await',
    'co_return',
    'co_yield',
    'decltype',
    'default',
    'delete',
    'do',
    'double',
    'dynamic_cast',
    'else',
    'enum',
    'explicit',
    'extern',
    'false',
    'float',
    'for',
    'friend',
    'if',
    'inline',
    'int',
    'long',
    'mutable',
    'namespace',
    'new',
    'noexcept',
    'nullptr',
    'operator',
    'private',
    'protected',
    'public',
    'register',
    'reinterpret_cast',
    'requires',
    'return',
    'short',
    'signed',
    'sizeof',
    'static',
    'static_assert',
    'static_cast',
    'struct',
    'switch',
    'template',
    'this',
    'throw',
    'true',
    'try',
    'typedef',
    'typename',
    'union',
    'unsigned',
    'using',
    'virtual',
    'void',
    'volatile',
    'while',
])

const CPP_BUILTINS = new Set([
    'int8_t',
    'int16_t',
    'int32_t',
    'int64_t',
    'size_t',
    'std',
    'uint8_t',
    'uint16_t',
    'uint32_t',
    'uint64_t',
])

const CUDA_BUILTINS = new Set([
    ...CPP_BUILTINS,
    'atomicAdd',
    'atomicCAS',
    'blockDim',
    'blockIdx',
    'cudaDeviceSynchronize',
    'cudaError_t',
    'cudaFree',
    'cudaGetLastError',
    'cudaMalloc',
    'cudaMemcpy',
    'cudaMemcpyDeviceToHost',
    'cudaMemcpyHostToDevice',
    'dim3',
    'gridDim',
    'threadIdx',
    'uint2',
    'uint3',
    'uint4',
    'warpSize',
])

const CUDA_QUALIFIERS = new Set([
    '__constant__',
    '__device__',
    '__global__',
    '__host__',
    '__inline__',
    '__launch_bounds__',
    '__managed__',
    '__noinline__',
    '__restrict__',
    '__shared__',
])

const NUMBER_PATTERN =
    /^(?:0[xX][\da-fA-F_]+(?:[uUlL]*)|0[bB][01_]+(?:[uUlL]*)|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?[fFlLuU]*)/
const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*/
const OPERATOR_PATTERN =
    /^(?:::|->\*|->|==|!=|<=|>=|\+\+|--|&&|\|\||<<=|>>=|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|##|[+\-*/%@=<>!?:&|^~#.,;()[\]{}])/

function readString(source: string, start: number) {
    const quote = source[start]
    if (quote !== "'" && quote !== '"') {
        return 0
    }

    let index = start + 1
    while (index < source.length) {
        if (source[index] === '\\') {
            index += 2
            continue
        }

        if (source[index] === quote) {
            return index + 1 - start
        }

        index += 1
    }

    return source.length - start
}

function pushToken(tokens: CudaHighlightToken[], type: CudaHighlightTokenType, text: string) {
    if (text.length === 0) {
        return
    }

    const previous = tokens[tokens.length - 1]
    if (previous?.type === type) {
        previous.text += text
        return
    }

    tokens.push({ text, type })
}

function pushCommentTokens(tokens: CudaHighlightToken[], text: string) {
    let index = 0
    const docTagPattern = /@\s*[A-Za-z_]\w*/g

    for (const match of text.matchAll(docTagPattern)) {
        const tagStart = match.index ?? 0
        const tag = match[0] ?? ''

        pushToken(tokens, 'comment', text.slice(index, tagStart))
        pushToken(tokens, 'magic', tag)
        index = tagStart + tag.length
    }

    pushToken(tokens, 'comment', text.slice(index))
}

function tokenizeCuda(source: string, initialState: CudaHighlightState, mode: CudaHighlightMode = 'cuda') {
    const tokens: CudaHighlightToken[] = []
    let index = 0
    let nextIdentifierType: CudaHighlightTokenType | null = null
    let inBlockComment = initialState.inBlockComment

    while (index < source.length) {
        if (inBlockComment) {
            const commentEnd = source.indexOf('*/', index)
            const end = commentEnd === -1 ? source.length : commentEnd + 2
            pushCommentTokens(tokens, source.slice(index, end))
            index = end
            inBlockComment = commentEnd === -1
            continue
        }

        const stringLength = readString(source, index)
        if (stringLength > 0) {
            pushToken(tokens, 'string', source.slice(index, index + stringLength))
            index += stringLength
            continue
        }

        const char = source[index] ?? ''
        if (char === '/' && source[index + 1] === '/') {
            const lineEnd = source.indexOf('\n', index)
            const end = lineEnd === -1 ? source.length : lineEnd
            pushCommentTokens(tokens, source.slice(index, end))
            index = end
            continue
        }

        if (char === '/' && source[index + 1] === '*') {
            const commentEnd = source.indexOf('*/', index + 2)
            const end = commentEnd === -1 ? source.length : commentEnd + 2
            pushCommentTokens(tokens, source.slice(index, end))
            index = end
            inBlockComment = commentEnd === -1
            continue
        }

        if (char === '#') {
            const directive = source.slice(index).match(/^#\s*[A-Za-z_]\w*/)
            if (directive) {
                pushToken(tokens, 'decorator', directive[0])
                index += directive[0].length
                continue
            }
        }

        const number = source.slice(index).match(NUMBER_PATTERN)
        if (number) {
            pushToken(tokens, 'number', number[0])
            index += number[0].length
            continue
        }

        const identifier = source.slice(index).match(IDENTIFIER_PATTERN)
        if (identifier) {
            const text = identifier[0]
            let type: CudaHighlightTokenType = 'plain'
            const afterIdentifier = source.slice(index + text.length)

            if (nextIdentifierType) {
                type = nextIdentifierType
                nextIdentifierType = null
            } else if (text === 'this') {
                type = 'self'
            } else if (mode === 'cuda' && CUDA_QUALIFIERS.has(text)) {
                type = 'decorator'
            } else if (CUDA_KEYWORDS.has(text)) {
                type = 'keyword'
                if (text === 'class' || text === 'struct' || text === 'enum' || text === 'typename') {
                    nextIdentifierType = 'class-name'
                }
            } else if ((mode === 'cuda' ? CUDA_BUILTINS : CPP_BUILTINS).has(text)) {
                type = 'builtin'
            } else if (/^\s*\(/.test(afterIdentifier)) {
                type = 'function'
            } else if (/^[A-Z]\w*$/.test(text) && /^\s*(?:[&*:<>,)]|$)/.test(afterIdentifier)) {
                type = 'class-name'
            }

            pushToken(tokens, type, text)
            index += text.length
            continue
        }

        const operator = source.slice(index).match(OPERATOR_PATTERN)
        if (operator) {
            const text = operator[0] ?? ''
            pushToken(tokens, 'operator', text)
            index += text.length
            continue
        }

        pushToken(tokens, 'plain', char)
        index += 1
    }

    return { state: { inBlockComment }, tokens }
}

export function highlightCuda(source: string) {
    return tokenizeCuda(source, { inBlockComment: false }).tokens
}

export function highlightCudaLine(source: string, state: CudaHighlightState) {
    return tokenizeCuda(source, state)
}

export function highlightCpp(source: string) {
    return tokenizeCuda(source, { inBlockComment: false }, 'cpp').tokens
}

export function highlightCppLine(source: string, state: CudaHighlightState) {
    return tokenizeCuda(source, state, 'cpp')
}
