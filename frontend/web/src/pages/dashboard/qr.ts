const VERSION = 5
const SIZE = 17 + VERSION * 4
const DATA_CODEWORDS = 108
const EC_CODEWORDS = 26

type Matrix = Array<Array<boolean | null>>

const EXP = new Array<number>(512)
const LOG = new Array<number>(256)

let gfReady = false

function initGf() {
    if (gfReady) return

    let value = 1
    for (let i = 0; i < 255; i += 1) {
        EXP[i] = value
        LOG[value] = i
        value <<= 1
        if (value & 0x100) value ^= 0x11d
    }
    for (let i = 255; i < 512; i += 1) {
        EXP[i] = EXP[i - 255]
    }
    gfReady = true
}

function gfMul(a: number, b: number) {
    if (a === 0 || b === 0) return 0
    return EXP[LOG[a] + LOG[b]]
}

function reedSolomonGenerator(degree: number) {
    initGf()
    let poly = [1]

    for (let i = 0; i < degree; i += 1) {
        const next = new Array(poly.length + 1).fill(0)
        for (let j = 0; j < poly.length; j += 1) {
            next[j] ^= gfMul(poly[j], EXP[i])
            next[j + 1] ^= poly[j]
        }
        poly = next
    }

    return poly
}

function reedSolomonRemainder(data: number[]) {
    const generator = reedSolomonGenerator(EC_CODEWORDS)
    const result = new Array(EC_CODEWORDS).fill(0)

    for (const byte of data) {
        const factor = byte ^ result.shift()!
        result.push(0)
        for (let i = 0; i < EC_CODEWORDS; i += 1) {
            result[i] ^= gfMul(generator[i], factor)
        }
    }

    return result
}

function appendBits(bits: number[], value: number, length: number) {
    for (let i = length - 1; i >= 0; i -= 1) {
        bits.push((value >>> i) & 1)
    }
}

function encodeData(value: string) {
    const bytes = Array.from(new TextEncoder().encode(value))
    if (bytes.length > 106) {
        throw new Error('QR link is too long.')
    }

    const bits: number[] = []
    appendBits(bits, 0b0100, 4)
    appendBits(bits, bytes.length, 8)
    bytes.forEach((byte) => appendBits(bits, byte, 8))
    appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length))

    while (bits.length % 8 !== 0) bits.push(0)

    const data: number[] = []
    for (let i = 0; i < bits.length; i += 8) {
        data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0))
    }

    for (let pad = 0xec; data.length < DATA_CODEWORDS; pad = pad === 0xec ? 0x11 : 0xec) {
        data.push(pad)
    }

    return [...data, ...reedSolomonRemainder(data)]
}

function createMatrix(): Matrix {
    return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null))
}

function setModule(matrix: Matrix, x: number, y: number, dark: boolean) {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) matrix[y][x] = dark
}

function drawFinder(matrix: Matrix, x: number, y: number) {
    for (let dy = -1; dy <= 7; dy += 1) {
        for (let dx = -1; dx <= 7; dx += 1) {
            const xx = x + dx
            const yy = y + dy
            const dark =
                dx >= 0 &&
                dx <= 6 &&
                dy >= 0 &&
                dy <= 6 &&
                (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4))
            setModule(matrix, xx, yy, dark)
        }
    }
}

function drawAlignment(matrix: Matrix, x: number, y: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
            setModule(matrix, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
    }
}

function reserveFormat(matrix: Matrix) {
    for (let i = 0; i < 9; i += 1) {
        if (i !== 6) {
            setModule(matrix, 8, i, false)
            setModule(matrix, i, 8, false)
        }
    }
    for (let i = 0; i < 8; i += 1) {
        setModule(matrix, SIZE - 1 - i, 8, false)
        setModule(matrix, 8, SIZE - 1 - i, false)
    }
    setModule(matrix, 8, SIZE - 8, true)
}

function drawFunctionPatterns(matrix: Matrix) {
    drawFinder(matrix, 0, 0)
    drawFinder(matrix, SIZE - 7, 0)
    drawFinder(matrix, 0, SIZE - 7)
    drawAlignment(matrix, 30, 30)

    for (let i = 8; i < SIZE - 8; i += 1) {
        const dark = i % 2 === 0
        setModule(matrix, i, 6, dark)
        setModule(matrix, 6, i, dark)
    }

    reserveFormat(matrix)
}

function mask(x: number, y: number) {
    return (x + y) % 2 === 0
}

function drawData(matrix: Matrix, codewords: number[]) {
    const bits = codewords.flatMap((byte) =>
        Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1),
    )
    let bitIndex = 0
    let upward = true

    for (let right = SIZE - 1; right > 0; right -= 2) {
        if (right === 6) right -= 1
        for (let vertical = 0; vertical < SIZE; vertical += 1) {
            const y = upward ? SIZE - 1 - vertical : vertical
            for (let offset = 0; offset < 2; offset += 1) {
                const x = right - offset
                if (matrix[y][x] !== null) continue

                const dark = Boolean(bits[bitIndex] ?? 0) !== mask(x, y)
                matrix[y][x] = dark
                bitIndex += 1
            }
        }
        upward = !upward
    }
}

function formatBits() {
    let bits = 0b01_000
    bits <<= 10
    const generator = 0b10100110111
    for (let i = 14; i >= 10; i -= 1) {
        if ((bits >>> i) & 1) bits ^= generator << (i - 10)
    }
    return ((0b01_000 << 10) | bits) ^ 0b101010000010010
}

function drawFormat(matrix: Matrix) {
    const bits = formatBits()
    const first = [
        [8, 0],
        [8, 1],
        [8, 2],
        [8, 3],
        [8, 4],
        [8, 5],
        [8, 7],
        [8, 8],
        [7, 8],
        [5, 8],
        [4, 8],
        [3, 8],
        [2, 8],
        [1, 8],
        [0, 8],
    ]
    const second = [
        [SIZE - 1, 8],
        [SIZE - 2, 8],
        [SIZE - 3, 8],
        [SIZE - 4, 8],
        [SIZE - 5, 8],
        [SIZE - 6, 8],
        [SIZE - 7, 8],
        [8, SIZE - 8],
        [8, SIZE - 7],
        [8, SIZE - 6],
        [8, SIZE - 5],
        [8, SIZE - 4],
        [8, SIZE - 3],
        [8, SIZE - 2],
        [8, SIZE - 1],
    ]

    for (let i = 0; i < 15; i += 1) {
        const dark = Boolean((bits >>> i) & 1)
        setModule(matrix, first[i][0], first[i][1], dark)
        setModule(matrix, second[i][0], second[i][1], dark)
    }
}

export function createQrPath(value: string) {
    const matrix = createMatrix()
    drawFunctionPatterns(matrix)
    drawData(matrix, encodeData(value))
    drawFormat(matrix)

    const dotRadius = 0.42
    const modules: string[] = []
    matrix.forEach((row, y) => {
        row.forEach((dark, x) => {
            if (!dark) return

            const cx = x + 4.5
            const cy = y + 4.5
            modules.push(
                `M${cx - dotRadius},${cy}a${dotRadius},${dotRadius} 0 1 0 ${dotRadius * 2},0a${dotRadius},${dotRadius} 0 1 0 -${dotRadius * 2},0`,
            )
        })
    })

    return {
        path: modules.join(' '),
        viewBox: `0 0 ${SIZE + 8} ${SIZE + 8}`,
    }
}
