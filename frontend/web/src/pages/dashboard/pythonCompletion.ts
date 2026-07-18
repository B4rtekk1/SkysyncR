export const PYTHON_KEYWORD_COMPLETIONS = [
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
]

export type PythonCompletionItem = {
    label: string
    type: 'keyword' | 'variable'
}

export type PythonCompletion = {
    end: number
    items: PythonCompletionItem[]
    prefix: string
    start: number
}

const VARIABLE_PATTERNS = [
    /\b([A-Za-z_]\w*)\s*(?::[^=\n]+)?=/g,
    /\bfor\s+([A-Za-z_]\w*)\s+in\b/g,
    /\bwith\s+[^:\n]+\s+as\s+([A-Za-z_]\w*)/g,
    /\bexcept\s+[^:\n]+\s+as\s+([A-Za-z_]\w*)/g,
    /\bimport\s+([A-Za-z_]\w*)/g,
    /\bfrom\s+[A-Za-z_][\w.]*\s+import\s+([A-Za-z_]\w*)/g,
]

const FUNCTION_PATTERN = /\b(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/g
const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/
const RESERVED_NAMES = new Set(PYTHON_KEYWORD_COMPLETIONS)

function addVariable(candidates: Set<string>, value: string | undefined) {
    if (!value || RESERVED_NAMES.has(value) || !IDENTIFIER_PATTERN.test(value)) {
        return
    }

    candidates.add(value)
}

function getFunctionParameterName(param: string) {
    const withoutDefault = param.trim().replace(/^\*+/, '').split('=')[0]?.trim() ?? ''
    const pythonName = withoutDefault.split(':')[0]?.trim() ?? ''
    if (IDENTIFIER_PATTERN.test(pythonName)) {
        return pythonName
    }

    const fallbackName = withoutDefault.match(/[A-Za-z_]\w*$/)?.[0]
    return fallbackName ?? ''
}

export function getPythonVariableCompletions(source: string, caret: number, prefix: string) {
    const candidates = new Set<string>()
    const searchableSource = source.slice(0, caret)

    for (const pattern of VARIABLE_PATTERNS) {
        let match: RegExpExecArray | null
        pattern.lastIndex = 0
        while ((match = pattern.exec(searchableSource)) !== null) {
            addVariable(candidates, match[1])
        }
    }

    let functionMatch: RegExpExecArray | null
    FUNCTION_PATTERN.lastIndex = 0
    while ((functionMatch = FUNCTION_PATTERN.exec(searchableSource)) !== null) {
        const params = functionMatch[1] ?? ''
        params.split(',').forEach((param) => {
            addVariable(candidates, getFunctionParameterName(param))
        })
    }

    return [...candidates]
        .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()) && name !== prefix)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 8)
}

export function getPythonKeywordCompletion(source: string, caret: number): PythonCompletion | null {
    const beforeCaret = source.slice(0, caret)
    const match = beforeCaret.match(/[A-Za-z_]\w*$/)
    if (!match) {
        return null
    }

    const prefix = match[0]
    if (prefix.length === 0) {
        return null
    }

    const start = caret - prefix.length
    const keywordItems = PYTHON_KEYWORD_COMPLETIONS.filter(
        (keyword) => keyword.toLowerCase().startsWith(prefix.toLowerCase()) && keyword !== prefix,
    ).map((keyword) => ({ label: keyword, type: 'keyword' as const }))
    const variableItems = getPythonVariableCompletions(source, start, prefix).map((variable) => ({
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

export function applyPythonCompletion(source: string, completion: PythonCompletion, item: PythonCompletionItem) {
    return `${source.slice(0, completion.start)}${item.label}${source.slice(completion.end)}`
}
