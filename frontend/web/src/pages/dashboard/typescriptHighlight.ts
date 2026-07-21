export type TypeScriptHighlightTokenType =
    | 'builtin'
    | 'class-name'
    | 'comment'
    | 'decorator'
    | 'function'
    | 'keyword'
    | 'number'
    | 'operator'
    | 'plain'
    | 'self'
    | 'string'

export type TypeScriptHighlightToken = {
    text: string
    type: TypeScriptHighlightTokenType
}

const TYPESCRIPT_KEYWORDS = new Set([
    'abstract',
    'as',
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'implements',
    'import',
    'in',
    'infer',
    'instanceof',
    'interface',
    'is',
    'keyof',
    'let',
    'module',
    'namespace',
    'new',
    'of',
    'private',
    'protected',
    'public',
    'readonly',
    'return',
    'satisfies',
    'set',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'type',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'with',
    'yield',
])

const TYPESCRIPT_BUILTINS = new Set([
    'Array',
    'ArrayBuffer',
    'BigInt',
    'Boolean',
    'Date',
    'Error',
    'Map',
    'Math',
    'Number',
    'Object',
    'Promise',
    'Record',
    'RegExp',
    'Set',
    'String',
    'Symbol',
    'WeakMap',
    'WeakSet',
    'any',
    'bigint',
    'boolean',
    'console',
    'false',
    'globalThis',
    'never',
    'null',
    'number',
    'object',
    'string',
    'true',
    'unknown',
])

const NUMBER_PATTERN = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?n?)/
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*/
const OPERATOR_PATTERN = /^(?:=>|===|!==|==|!=|<=|>=|\+\+|--|\?\?|\?\.|&&|\|\||<<|>>>|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[+\-*/%@=<>!?:&|^~.,;()[\]{}])/

function readQuotedString(source: string, start: number) {
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

function readTemplateString(source: string, start: number) {
    if (source[start] !== '`') {
        return 0
    }

    let index = start + 1
    while (index < source.length) {
        if (source[index] === '\\') {
            index += 2
            continue
        }

        if (source[index] === '`') {
            return index + 1 - start
        }

        index += 1
    }

    return source.length - start
}

function pushToken(tokens: TypeScriptHighlightToken[], type: TypeScriptHighlightTokenType, text: string) {
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

export function highlightTypeScript(source: string) {
    const tokens: TypeScriptHighlightToken[] = []
    let index = 0
    let nextIdentifierType: TypeScriptHighlightTokenType | null = null

    while (index < source.length) {
        const quotedStringLength = readQuotedString(source, index)
        if (quotedStringLength > 0) {
            pushToken(tokens, 'string', source.slice(index, index + quotedStringLength))
            index += quotedStringLength
            continue
        }

        const templateStringLength = readTemplateString(source, index)
        if (templateStringLength > 0) {
            pushToken(tokens, 'string', source.slice(index, index + templateStringLength))
            index += templateStringLength
            continue
        }

        const char = source[index] ?? ''
        if (char === '/' && source[index + 1] === '/') {
            const lineEnd = source.indexOf('\n', index)
            const end = lineEnd === -1 ? source.length : lineEnd
            pushToken(tokens, 'comment', source.slice(index, end))
            index = end
            continue
        }

        if (char === '/' && source[index + 1] === '*') {
            const commentEnd = source.indexOf('*/', index + 2)
            const end = commentEnd === -1 ? source.length : commentEnd + 2
            pushToken(tokens, 'comment', source.slice(index, end))
            index = end
            continue
        }

        if (char === '@') {
            const decorator = source.slice(index).match(/^@[A-Za-z_$][\w$.]*/)
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
            let type: TypeScriptHighlightTokenType = 'plain'
            const afterIdentifier = source.slice(index + text.length)

            if (nextIdentifierType) {
                type = nextIdentifierType
                nextIdentifierType = null
            } else if (text === 'this' || text === 'super') {
                type = 'self'
            } else if (TYPESCRIPT_KEYWORDS.has(text)) {
                type = 'keyword'
                if (text === 'class' || text === 'interface' || text === 'type' || text === 'enum') {
                    nextIdentifierType = 'class-name'
                } else if (text === 'function') {
                    nextIdentifierType = 'function'
                }
            } else if (TYPESCRIPT_BUILTINS.has(text)) {
                type = 'builtin'
            } else if (/^\s*[<([]/.test(afterIdentifier)) {
                type = 'function'
            } else if (/^[A-Z]/.test(text) && /^\s*(?:[:<>,)]|extends\b|implements\b|$)/.test(afterIdentifier)) {
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

    return tokens
}
