export function mimeTypeForCreatedFile(filename: string) {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
    if (lower.endsWith('.csv')) return 'text/csv'
    if (lower.endsWith('.json')) return 'application/json'
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
    if (lower.endsWith('.css')) return 'text/css'
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'text/javascript'
    if (lower.endsWith('.py') || lower.endsWith('.pyi') || lower.endsWith('.pyw')) return 'text/x-python'
    return 'text/plain'
}

export function hasFileExtension(filename: string) {
    return /\.[^.\s/\\]+$/.test(filename)
}
