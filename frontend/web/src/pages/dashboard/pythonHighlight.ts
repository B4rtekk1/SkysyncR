export type PythonHighlightTokenType =
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

export type PythonHighlightToken = {
    text: string
    type: PythonHighlightTokenType
}

const PYTHON_KEYWORDS = new Set([
    'False',
    'None',
    'True',
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
])

const PYTHON_BUILTINS = new Set([
    'abs',
    'all',
    'any',
    'bool',
    'bytes',
    'callable',
    'chr',
    'dict',
    'dir',
    'enumerate',
    'Exception',
    'filter',
    'float',
    'frozenset',
    'getattr',
    'hasattr',
    'int',
    'isinstance',
    'issubclass',
    'len',
    'list',
    'map',
    'max',
    'min',
    'next',
    'object',
    'open',
    'print',
    'property',
    'range',
    'repr',
    'reversed',
    'round',
    'set',
    'setattr',
    'slice',
    'sorted',
    'str',
    'sum',
    'super',
    'tuple',
    'type',
    'ValueError',
    'zip',
])

const STRING_PREFIX = /[rRuUbBfF]/
const NUMBER_PATTERN = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?j?)/
const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*/
const OPERATOR_PATTERN = /^(?:->|:=|\*\*|\/\/|==|!=|<=|>=|[+\-*/%@=<>:&|^~.,;()[\]{}])/

function readString(source: string, start: number) {
    let index = start
    while (STRING_PREFIX.test(source[index] ?? '') && index < source.length) {
        index += 1
    }

    const quote = source[index]
    if (quote !== "'" && quote !== '"') {
        return 0
    }

    const isTriple = source.slice(index, index + 3) === quote.repeat(3)
    index += isTriple ? 3 : 1

    while (index < source.length) {
        if (source[index] === '\\') {
            index += 2
            continue
        }

        if (isTriple && source.slice(index, index + 3) === quote.repeat(3)) {
            return index + 3 - start
        }

        if (!isTriple && source[index] === quote) {
            return index + 1 - start
        }

        index += 1
    }

    return source.length - start
}

function pushToken(tokens: PythonHighlightToken[], type: PythonHighlightTokenType, text: string) {
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

export function highlightPython(source: string) {
    const tokens: PythonHighlightToken[] = []
    let index = 0
    let nextIdentifierType: PythonHighlightTokenType | null = null

    while (index < source.length) {
        const stringLength = readString(source, index)
        if (stringLength > 0) {
            pushToken(tokens, 'string', source.slice(index, index + stringLength))
            index += stringLength
            continue
        }

        const char = source[index] ?? ''
        if (char === '#') {
            const lineEnd = source.indexOf('\n', index)
            const end = lineEnd === -1 ? source.length : lineEnd
            pushToken(tokens, 'comment', source.slice(index, end))
            index = end
            continue
        }

        if (char === '@') {
            const decorator = source.slice(index).match(/^@[A-Za-z_][\w.]*/)
            if (decorator) {
                pushToken(tokens, 'decorator', decorator[0])
                index += decorator[0].length
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
            let type: PythonHighlightTokenType = 'plain'

            if (nextIdentifierType) {
                type = nextIdentifierType
                nextIdentifierType = null
            } else if (PYTHON_KEYWORDS.has(text)) {
                type = 'keyword'
                if (text === 'def') {
                    nextIdentifierType = 'function'
                } else if (text === 'class') {
                    nextIdentifierType = 'class-name'
                }
            } else if (/^__\w+__$/.test(text)) {
                type = 'magic'
            } else if (text === 'self' || text === 'cls') {
                type = 'self'
            } else if (PYTHON_BUILTINS.has(text)) {
                type = 'builtin'
            } else if (/^\s*\(/.test(source.slice(index + text.length))) {
                type = 'function'
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

    return tokens
}
