export const TYPESCRIPT_KEYWORD_COMPLETIONS = [
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
    'if',
    'implements',
    'import',
    'in',
    'infer',
    'instanceof',
    'interface',
    'keyof',
    'let',
    'namespace',
    'new',
    'of',
    'private',
    'protected',
    'public',
    'readonly',
    'return',
    'satisfies',
    'static',
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
]

export type TypeScriptCompletionItem = {
    label: string
    type: 'keyword' | 'variable'
}

export type TypeScriptCompletion = {
    end: number
    items: TypeScriptCompletionItem[]
    prefix: string
    start: number
}

const VARIABLE_PATTERNS = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bfor\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\b/g,
    /\bimport\s+\{\s*([A-Za-z_$][\w$]*)/g,
]

const FUNCTION_PATTERN = /\b(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g
const ARROW_FUNCTION_PATTERN = /\(([^)]*)\)\s*(?::\s*[^=]+)?=>/g
const METHOD_PATTERN = /(?:^|[\n;{]\s*)(?!(?:for|if|while|switch|catch)\b)(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/g
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/
const CLOSING_PARAMETER_CHARS = ')]}>'
const RESERVED_NAMES = new Set(TYPESCRIPT_KEYWORD_COMPLETIONS)

function addVariable(candidates: Set<string>, value: string | undefined) {
    if (!value || RESERVED_NAMES.has(value) || !IDENTIFIER_PATTERN.test(value)) {
        return
    }

    candidates.add(value)
}

function splitParameters(params: string) {
    const result: string[] = []
    let depth = 0
    let quote: string | null = null
    let start = 0

    for (let index = 0; index < params.length; index += 1) {
        const char = params[index] ?? ''
        if (quote) {
            if (char === '\\') {
                index += 1
            } else if (char === quote) {
                quote = null
            }
        } else if (char === "'" || char === '"' || char === '`') {
            quote = char
        } else if ('([{<'.includes(char)) {
            depth += 1
        } else if (CLOSING_PARAMETER_CHARS.includes(char)) {
            depth = Math.max(0, depth - 1)
        } else if (char === ',' && depth === 0) {
            result.push(params.slice(start, index).trim())
            start = index + 1
        }
    }

    result.push(params.slice(start).trim())
    return result.filter(Boolean)
}

function getParameterName(param: string) {
    const withoutDefault = param.trim().replace(/^(?:public|private|protected|readonly)\s+/, '').split('=')[0]?.trim() ?? ''
    const name = withoutDefault.split(':')[0]?.replace(/^\.\.\./, '').trim() ?? ''
    if (IDENTIFIER_PATTERN.test(name)) {
        return name
    }

    return withoutDefault.match(/[A-Za-z_$][\w$]*$/)?.[0] ?? ''
}

function collectFunctionParameters(candidates: Set<string>, source: string, pattern: RegExp) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(source)) !== null) {
        splitParameters(match[1] ?? '').forEach((param) => addVariable(candidates, getParameterName(param)))
    }
}

export function getTypeScriptVariableCompletions(source: string, caret: number, prefix: string) {
    const candidates = new Set<string>()
    const searchableSource = source.slice(0, caret)

    for (const pattern of VARIABLE_PATTERNS) {
        let match: RegExpExecArray | null
        pattern.lastIndex = 0
        while ((match = pattern.exec(searchableSource)) !== null) {
            addVariable(candidates, match[1])
        }
    }

    collectFunctionParameters(candidates, searchableSource, FUNCTION_PATTERN)
    collectFunctionParameters(candidates, searchableSource, ARROW_FUNCTION_PATTERN)
    collectFunctionParameters(candidates, searchableSource, METHOD_PATTERN)

    return [...candidates]
        .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()) && name !== prefix)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 8)
}

export function getTypeScriptKeywordCompletion(source: string, caret: number): TypeScriptCompletion | null {
    const beforeCaret = source.slice(0, caret)
    const match = beforeCaret.match(/[A-Za-z_$][\w$]*$/)
    if (!match) {
        return null
    }

    const prefix = match[0]
    if (prefix.length === 0) {
        return null
    }

    const start = caret - prefix.length
    const keywordItems = TYPESCRIPT_KEYWORD_COMPLETIONS.filter(
        (keyword) => keyword.toLowerCase().startsWith(prefix.toLowerCase()) && keyword !== prefix,
    ).map((keyword) => ({ label: keyword, type: 'keyword' as const }))
    const variableItems = getTypeScriptVariableCompletions(source, start, prefix).map((variable) => ({
        label: variable,
        type: 'variable' as const,
    }))
    const seen = new Set<string>()
    const items = [...variableItems, ...keywordItems]
        .filter((item) => {
            if (seen.has(item.label)) {
                return false
            }

            seen.add(item.label)
            return true
        })
        .slice(0, 8)

    return items.length > 0 ? { end: caret, items, prefix, start } : null
}

export function applyTypeScriptCompletion(
    source: string,
    completion: TypeScriptCompletion,
    item: TypeScriptCompletionItem,
) {
    return `${source.slice(0, completion.start)}${item.label}${source.slice(completion.end)}`
}
