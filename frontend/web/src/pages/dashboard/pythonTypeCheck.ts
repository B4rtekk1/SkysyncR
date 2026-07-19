export type PythonTypeDiagnostic = {
    column: number
    line: number
    message: string
    severity: 'warning'
}

type InferredPythonType = 'bool' | 'dict' | 'float' | 'int' | 'list' | 'None' | 'set' | 'str' | 'tuple' | 'unknown'
type FunctionScope = {
    indent: number
    name: string
    returnType: string | null
    variables: Map<string, string>
}

const TYPE_ALIASES = new Map([
    ['Dict', 'dict'],
    ['List', 'list'],
    ['Optional', 'optional'],
    ['Set', 'set'],
    ['Tuple', 'tuple'],
])

const VARIABLE_ANNOTATION_PATTERN = /^\s*([A-Za-z_]\w*)\s*:\s*([^=\n#]+)\s*=\s*(.+?)(?:\s+#.*)?$/
const VARIABLE_ASSIGNMENT_PATTERN = /^\s*([A-Za-z_]\w*)\s*=\s*(.+?)(?:\s+#.*)?$/
const FUNCTION_PATTERN = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*(?:->\s*([^:]+))?:/
const RETURN_PATTERN = /^\s*return(?:\s+(.+?))?(?:\s+#.*)?$/

function stripSimpleString(value: string) {
    const quote = value[0]
    if ((quote !== "'" && quote !== '"') || value.length < 2) {
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

function normalizeAnnotation(annotation: string) {
    const trimmed = annotation.trim()
    const outerName = trimmed.match(/^([A-Za-z_]\w*)/)?.[1] ?? trimmed
    const aliased = TYPE_ALIASES.get(outerName) ?? outerName

    if (aliased === 'optional' || /\bNone\b/.test(trimmed)) {
        return 'optional'
    }

    return aliased
}

function inferLiteralType(value: string): InferredPythonType {
    const expression = value.trim()
    if (expression.length === 0) {
        return 'unknown'
    }

    if (expression === 'None') {
        return 'None'
    }

    if (expression === 'True' || expression === 'False') {
        return 'bool'
    }

    if (expression.startsWith("'") || expression.startsWith('"')) {
        return stripSimpleString(expression).length > 1 ? 'str' : 'unknown'
    }

    if (/^[+-]?(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*)$/.test(expression)) {
        return 'int'
    }

    if (/^[+-]?(?:(?:\d[\d_]*\.\d*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?|\d[\d_]*[eE][+-]?[\d_]+)$/.test(expression)) {
        return 'float'
    }

    if (expression.startsWith('[')) {
        return 'list'
    }

    if (expression.startsWith('(')) {
        return 'tuple'
    }

    if (expression.startsWith('{')) {
        return expression.includes(':') ? 'dict' : 'set'
    }

    return 'unknown'
}

function isCompatibleType(expectedAnnotation: string, actualType: InferredPythonType) {
    if (actualType === 'unknown') {
        return true
    }

    const expected = normalizeAnnotation(expectedAnnotation)
    if (expected === 'Any' || expected === 'object' || expected === actualType) {
        return true
    }

    if (expected === 'float' && actualType === 'int') {
        return true
    }

    return expected === 'optional' && actualType === 'None'
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
        } else if (char === "'" || char === '"') {
            quote = char
        } else if ('([{'.includes(char)) {
            depth += 1
        } else if (')]}'.includes(char)) {
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
    diagnostics: PythonTypeDiagnostic[],
    line: number,
    column: number,
    expected: string,
    actual: InferredPythonType,
    context: string,
) {
    diagnostics.push({
        column,
        line,
        message: `${context} expects ${expected.trim()}, but the static checker inferred ${actual}.`,
        severity: 'warning',
    })
}

export function checkPythonTypes(source: string) {
    const diagnostics: PythonTypeDiagnostic[] = []
    const functionScopes: FunctionScope[] = []
    const lines = source.split('\n')

    lines.forEach((line, index) => {
        const lineNumber = index + 1
        const indent = line.match(/^\s*/)?.[0].length ?? 0
        while (functionScopes.length > 0 && indent <= (functionScopes.at(-1)?.indent ?? 0) && line.trim() !== '') {
            functionScopes.pop()
        }

        const variableMatch = line.match(VARIABLE_ANNOTATION_PATTERN)
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
                const annotationMatch = param.match(/^\*{0,2}([A-Za-z_]\w*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/)
                if (annotationMatch) {
                    const [, paramName, annotation] = annotationMatch
                    if (paramName && annotation) {
                        variables.set(paramName, annotation)
                    }
                }

                const match = param.match(/^\*{0,2}([A-Za-z_]\w*)\s*:\s*([^=]+?)\s*=\s*(.+)$/)
                if (!match) {
                    return
                }

                const [, paramName, annotation, value] = match
                const actualType = inferLiteralType(value ?? '')
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
            })

            if (functionName) {
                functionScopes.push({ indent, name: functionName, returnType: returnType ?? null, variables })
            }
        }

        const assignmentMatch = line.match(VARIABLE_ASSIGNMENT_PATTERN)
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
            const actualType = inferLiteralType(returnMatch[1] ?? 'None')
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
    })

    return diagnostics
}
