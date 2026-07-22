type ZipEntry = {
    path: string
    blob: Blob
    modifiedAt?: Date
}

const encoder = new TextEncoder()
const crcTable = makeCrcTable()

export async function createZip(entries: ZipEntry[]): Promise<Blob> {
    const chunks: BlobPart[] = []
    const centralDirectory: Uint8Array[] = []
    let offset = 0

    for (const entry of entries) {
        const name = normalizeZipPath(entry.path)
        if (!name) continue

        const data = new Uint8Array(await entry.blob.arrayBuffer())
        const filename = encoder.encode(name)
        const crc = crc32(data)
        const { date, time } = dosDateTime(entry.modifiedAt ?? new Date())
        const localHeader = new Uint8Array(30 + filename.byteLength)
        const local = new DataView(localHeader.buffer)

        local.setUint32(0, 0x04034b50, true)
        local.setUint16(4, 20, true)
        local.setUint16(6, 0x0800, true)
        local.setUint16(8, 0, true)
        local.setUint16(10, time, true)
        local.setUint16(12, date, true)
        local.setUint32(14, crc, true)
        local.setUint32(18, data.byteLength, true)
        local.setUint32(22, data.byteLength, true)
        local.setUint16(26, filename.byteLength, true)
        localHeader.set(filename, 30)

        chunks.push(arrayBufferFromBytes(localHeader), arrayBufferFromBytes(data))

        const centralHeader = new Uint8Array(46 + filename.byteLength)
        const central = new DataView(centralHeader.buffer)
        central.setUint32(0, 0x02014b50, true)
        central.setUint16(4, 20, true)
        central.setUint16(6, 20, true)
        central.setUint16(8, 0x0800, true)
        central.setUint16(10, 0, true)
        central.setUint16(12, time, true)
        central.setUint16(14, date, true)
        central.setUint32(16, crc, true)
        central.setUint32(20, data.byteLength, true)
        central.setUint32(24, data.byteLength, true)
        central.setUint16(28, filename.byteLength, true)
        central.setUint32(42, offset, true)
        centralHeader.set(filename, 46)
        centralDirectory.push(centralHeader)

        offset += localHeader.byteLength + data.byteLength
    }

    const centralDirectorySize = centralDirectory.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    chunks.push(...centralDirectory.map(arrayBufferFromBytes))

    const end = new Uint8Array(22)
    const endView = new DataView(end.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(8, centralDirectory.length, true)
    endView.setUint16(10, centralDirectory.length, true)
    endView.setUint32(12, centralDirectorySize, true)
    endView.setUint32(16, offset, true)
    chunks.push(arrayBufferFromBytes(end))

    return new Blob(chunks, { type: 'application/zip' })
}

export function safeZipName(value: string, fallback = 'download'): string {
    const name = value
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\u0000-\u001f]/g, '_')
        .trim()
        .replace(/^\.+$/, '')

    return name || fallback
}

export function uniqueZipPath(path: string, usedPaths: Set<string>): string {
    const normalized = normalizeZipPath(path)
    if (!usedPaths.has(normalized)) {
        usedPaths.add(normalized)
        return normalized
    }

    const slash = normalized.lastIndexOf('/')
    const directory = slash >= 0 ? normalized.slice(0, slash + 1) : ''
    const filename = slash >= 0 ? normalized.slice(slash + 1) : normalized
    const dot = filename.lastIndexOf('.')
    const base = dot > 0 ? filename.slice(0, dot) : filename
    const extension = dot > 0 ? filename.slice(dot) : ''
    let index = 2

    while (true) {
        const candidate = `${directory}${base} (${index})${extension}`
        if (!usedPaths.has(candidate)) {
            usedPaths.add(candidate)
            return candidate
        }
        index += 1
    }
}

function normalizeZipPath(path: string): string {
    return path
        .split(/[\\/]+/)
        .map((part) => safeZipName(part, 'item'))
        .filter(Boolean)
        .join('/')
}

function dosDateTime(date: Date) {
    const year = Math.max(1980, date.getFullYear())
    return {
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    }
}

function makeCrcTable(): Uint32Array {
    const table = new Uint32Array(256)
    for (let i = 0; i < table.length; i += 1) {
        let value = i
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        }
        table[i] = value >>> 0
    }
    return table
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of data) {
        crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
