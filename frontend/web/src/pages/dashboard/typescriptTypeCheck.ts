export type TypeScriptTypeDiagnostic = {
    column: number
    line: number
    message: string
    severity: 'warning'
}

type InferredTypeScriptType =
    | 'any'
    | 'boolean'
    | 'null'
    | 'number'
    | 'object'
    | 'string'
    | 'undefined'
    | 'unknown'
    | 'array'

type FunctionScope = {
    braceDepth: number
    name: string
    returnType: string | null
    variables: Map<string, string>
}

const VARIABLE_DECLARATION_PATTERN = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=;]+))?\s*=\s*(.+?)(?:;?\s*(?:\/\/.*)?)?$/
const ASSIGNMENT_PATTERN = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(.+?)(?:;?\s*(?:\/\/.*)?)?$/
const FUNCTION_PATTERN = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\((.*)\)\s*(?::\s*([^{]+))?\s*\{?/
const RETURN_PATTERN = /^\s*return(?:\s+(.+?))?(?:;?\s*(?:\/\/.*)?)?$/
const CLOSING_PARAMETER_CHARS = ')]}>'

function stripSimpleString(value: string) {
    const quote = value[0]
    if ((quote !== "'" && quote !== '"' && quote !== '`') || value.length < 2) {
        return value
    }

    let index = 1
    while (index < value.length) {
        if (value[index] === '\\') {
            index += 2
            continue
        }

        if (value[index] === quote) {
            return value.slice(0, index + 1)
        }

        index += 1
    }

    return value
}

function normalizeAnnotation(annotation: string): string {
    const trimmed = annotation.trim().replace(/;$/, '')
    if (trimmed.endsWith('[]') || /^Array\s*</.test(trimmed)) {
        return 'array'
    }

    if (trimmed.includes('|')) {
        return trimmed
            .split('|')
            .map((part: string) => normalizeAnnotation(part))
            .join('|')
    }

    return trimmed
}

function inferLiteralType(value: string): InferredTypeScriptType {
    const expression = value.trim().replace(/;$/, '')
    if (expression.length === 0) {
        return 'unknown'
    }

    if (expression === 'undefined') {
        return 'undefined'
    }

    if (expression === 'null') {
        return 'null'
    }

    if (expression === 'true' || expression === 'false') {
        return 'boolean'
    }

    if (expression.startsWith("'") || expression.startsWith('"') || expression.startsWith('`')) {
        return stripSimpleString(expression).length > 1 ? 'string' : 'unknown'
    }

    if (/^[+-]?(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?)n?$/.test(expression)) {
        return 'number'
    }

    if (expression.startsWith('[')) {
        return 'array'
    }

    if (expression.startsWith('{')) {
        return 'object'
    }

    return 'unknown'
}

function isCompatibleType(expectedAnnotation: string, actualType: InferredTypeScriptType) {
    if (actualType === 'unknown') {
        return true
    }

    const expected = normalizeAnnotation(expectedAnnotation)
    if (expected === 'any' || expected === 'unknown' || expected === actualType) {
        return true
    }

    return expected.split('|').some((part) => part.trim() === actualType)
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

function addMismatchDiagnostic(
    diagnostics: TypeScriptTypeDiagnostic[],
    line: number,
    column: number,
    expected: string,
    actual: InferredTypeScriptType,
    context: string,
) {
    diagnostics.push({
        column,
        line,
        message: `${context} expects ${expected.trim()}, but the static checker inferred ${actual}.`,
        severity: 'warning',
    })
}

function braceDelta(line: string) {
    return (line.match(/\{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)
}

export function checkTypeScriptTypes(source: string) {
    const diagnostics: TypeScriptTypeDiagnostic[] = []
    const functionScopes: FunctionScope[] = []
    const lines = source.split('\n')
    let depth = 0

    lines.forEach((line, index) => {
        const lineNumber = index + 1
        while (functionScopes.length > 0 && depth < (functionScopes.at(-1)?.braceDepth ?? 0)) {
            functionScopes.pop()
        }

        const variableMatch = line.match(VARIABLE_DECLARATION_PATTERN)
        if (variableMatch) {
            const [, name, annotation, value] = variableMatch
            if (name && annotation) {
                functionScopes.at(-1)?.variables.set(name, annotation)
            }

            const actualType = inferLiteralType(value ?? '')
            if (annotation && !isCompatibleType(annotation, actualType)) {
                addMismatchDiagnostic(
                    diagnostics,
                    lineNumber,
                    line.indexOf(name ?? '') + 1,
                    annotation,
                    actualType,
                    `Variable "${name}"`,
                )
            }
        }

        const functionMatch = line.match(FUNCTION_PATTERN)
        if (functionMatch) {
            const [, functionName, params, returnType] = functionMatch
            const variables = new Map<string, string>()

            splitParameters(params ?? '').forEach((param) => {
                const match = param.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\??\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/)
                if (!match) {
                    return
                }

                const [, paramName, annotation, value] = match
                if (paramName && annotation) {
                    variables.set(paramName, annotation)
                }

                if (value) {
                    const actualType = inferLiteralType(value)
                    if (annotation && !isCompatibleType(annotation, actualType)) {
                        addMismatchDiagnostic(
                            diagnostics,
                            lineNumber,
                            line.indexOf(paramName ?? '') + 1,
                            annotation,
                            actualType,
                            `Parameter "${paramName}"`,
                        )
                    }
                }
            })

            if (functionName) {
                functionScopes.push({
                    braceDepth: depth + Math.max(1, braceDelta(line)),
                    name: functionName,
                    returnType: returnType ?? null,
                    variables,
                })
            }
        }

        const assignmentMatch = line.match(ASSIGNMENT_PATTERN)
        const currentScope = functionScopes.at(-1)
        if (assignmentMatch && currentScope && !variableMatch) {
            const [, name, value] = assignmentMatch
            const annotation = name ? currentScope.variables.get(name) : null
            const actualType = inferLiteralType(value ?? '')
            if (annotation && !isCompatibleType(annotation, actualType)) {
                addMismatchDiagnostic(
                    diagnostics,
                    lineNumber,
                    line.indexOf(name ?? '') + 1,
                    annotation,
                    actualType,
                    `Variable "${name}"`,
                )
            }
        }

        const returnMatch = line.match(RETURN_PATTERN)
        const currentFunction = functionScopes.at(-1)
        if (returnMatch && currentFunction?.returnType) {
            const actualType = inferLiteralType(returnMatch[1] ?? 'undefined')
            if (!isCompatibleType(currentFunction.returnType, actualType)) {
                addMismatchDiagnostic(
                    diagnostics,
                    lineNumber,
                    line.indexOf('return') + 1,
                    currentFunction.returnType,
                    actualType,
                    `Function "${currentFunction.name}" return`,
                )
            }
        }

        depth += braceDelta(line)
    })

    return diagnostics
}
