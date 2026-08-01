export function readQuotedString(source: string, start: number) {
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
