export type ZipEntry = {
    path: string
    blob: Blob
    modifiedAt?: Date
}

export type ZipStreamEntry = {
    path: string
    size: number
    modifiedAt?: Date
    open: () => Promise<Blob | ReadableStream<Uint8Array>>
}

export type ZipDownloadEstimate = {
    fileCount: number
    totalBytes: number
    peakMemoryBytes: number
}

type WritableFileHandle = {
    createWritable: () => Promise<WritableStream<Uint8Array>>
}

type SaveFilePickerOptions = {
    suggestedName?: string
    types?: Array<{
        description?: string
        accept: Record<string, string[]>
    }>
}

type WindowWithSaveFilePicker = Window & {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<WritableFileHandle>
}

const encoder = new TextEncoder()
const crcTable = makeCrcTable()
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008
const ZIP_UTF8_FLAG = 0x0800
const ZIP_FLAGS = ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG
const UINT32_MAX = 0xffffffff

export const STREAMING_ZIP_DOWNLOAD_LIMIT_BYTES = 3 * 1024 * 1024 * 1024
export const FALLBACK_ZIP_DOWNLOAD_LIMIT_BYTES = 512 * 1024 * 1024
export const LARGE_ZIP_CONFIRM_BYTES = 256 * 1024 * 1024

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

export function canStreamZipToFile(): boolean {
    return typeof window !== 'undefined' && typeof (window as WindowWithSaveFilePicker).showSaveFilePicker === 'function'
}

export async function openZipWritableFile(filename: string): Promise<WritableStream<Uint8Array> | null> {
    const picker = (window as WindowWithSaveFilePicker).showSaveFilePicker
    if (!picker) return null

    const result = await picker({
        suggestedName: filename,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    }).then(
        (handle) => ({ handle }),
        (error: unknown) => {
            if (error instanceof DOMException && error.name === 'AbortError') return { handle: null }
            return { error }
        },
    )

    if ('error' in result) throw result.error
    return result.handle ? result.handle.createWritable() : null
}

export function estimateZipDownload(
    entries: Array<{ path: string; size: number }>,
    streamingSupported = canStreamZipToFile(),
): ZipDownloadEstimate {
    const fileBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
    const zipOverheadBytes = entries.reduce((sum, entry) => sum + 92 + encoder.encode(entry.path).byteLength * 2, 22)
    const largestFileBytes = entries.reduce((max, entry) => Math.max(max, entry.size), 0)

    return {
        fileCount: entries.length,
        totalBytes: fileBytes + zipOverheadBytes,
        peakMemoryBytes: streamingSupported
            ? largestFileBytes * 2 + 16 * 1024 * 1024
            : fileBytes * 2 + zipOverheadBytes + 16 * 1024 * 1024,
    }
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export async function saveZipFile(
    filename: string,
    entries: ZipStreamEntry[],
    writable?: WritableStream<Uint8Array> | null,
): Promise<void> {
    if (writable) {
        await writeZipStream(writable, entries)
        return
    }

    const zip = await createZip(await collectBlobEntries(entries))
    const url = URL.createObjectURL(zip)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeZipName(value: string, fallback = 'download'): string {
    const name = value
        .replace(/[\\/:*?"<>|]/g, '_')
        .split('')
        .map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
        .join('')
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

async function writeZipStream(writable: WritableStream<Uint8Array>, entries: ZipStreamEntry[]): Promise<void> {
    const writer = writable.getWriter()
    const centralDirectory: Uint8Array[] = []
    let offset = 0
    let failed = false
    let failure: unknown

    for (const entry of entries) {
        assertZipUint32(entry.size)
    }

    try {
        for (const entry of entries) {
            const name = normalizeZipPath(entry.path)
            if (!name) continue

            const filename = encoder.encode(name)
            const { date, time } = dosDateTime(entry.modifiedAt ?? new Date())
            const localHeader = localFileHeader(filename, time, date)
            await writer.write(localHeader)

            const startOffset = offset
            offset += localHeader.byteLength

            const source = await entry.open()
            const reader = source instanceof Blob ? source.stream().getReader() : source.getReader()
            let crc = 0xffffffff
            let size = 0

            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    crc = crc32Update(crc, value)
                    size += value.byteLength
                    offset += value.byteLength
                    assertZipUint32(size)
                    await writer.write(value)
                }
            } finally {
                reader.releaseLock()
            }

            const finalCrc = crc32Finalize(crc)
            const descriptor = dataDescriptor(finalCrc, size)
            await writer.write(descriptor)
            offset += descriptor.byteLength

            centralDirectory.push(centralFileHeader(filename, time, date, finalCrc, size, startOffset))
        }

        const centralDirectoryOffset = offset
        let centralDirectorySize = 0
        for (const header of centralDirectory) {
            centralDirectorySize += header.byteLength
            await writer.write(header)
        }

        await writer.write(endOfCentralDirectory(centralDirectory.length, centralDirectorySize, centralDirectoryOffset))
        await writer.close()
    } catch (error) {
        failed = true
        failure = error
    } finally {
        if (failed) await writer.abort(failure)
    }

    if (failed) throw failure
}

function assertZipUint32(value: number): void {
    if (value > UINT32_MAX) {
        throw new Error('A single file is too large for this ZIP format.')
    }
}

async function collectBlobEntries(entries: ZipStreamEntry[]): Promise<ZipEntry[]> {
    const collected: ZipEntry[] = []
    for (const entry of entries) {
        const source = await entry.open()
        collected.push({
            path: entry.path,
            blob: source instanceof Blob ? source : await new Response(source).blob(),
            ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
        })
    }
    return collected
}

function localFileHeader(filename: Uint8Array, time: number, date: number): Uint8Array {
    const localHeader = new Uint8Array(30 + filename.byteLength)
    const local = new DataView(localHeader.buffer)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, ZIP_FLAGS, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint16(26, filename.byteLength, true)
    localHeader.set(filename, 30)
    return localHeader
}

function dataDescriptor(crc: number, size: number): Uint8Array {
    const descriptor = new Uint8Array(16)
    const view = new DataView(descriptor.buffer)
    view.setUint32(0, 0x08074b50, true)
    view.setUint32(4, crc, true)
    view.setUint32(8, size, true)
    view.setUint32(12, size, true)
    return descriptor
}

function centralFileHeader(
    filename: Uint8Array,
    time: number,
    date: number,
    crc: number,
    size: number,
    offset: number,
): Uint8Array {
    if (offset > UINT32_MAX) {
        throw new Error('This folder is too large for this ZIP format.')
    }

    const centralHeader = new Uint8Array(46 + filename.byteLength)
    const central = new DataView(centralHeader.buffer)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, ZIP_FLAGS, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, time, true)
    central.setUint16(14, date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, size, true)
    central.setUint32(24, size, true)
    central.setUint16(28, filename.byteLength, true)
    central.setUint32(42, offset, true)
    centralHeader.set(filename, 46)
    return centralHeader
}

function endOfCentralDirectory(entryCount: number, directorySize: number, directoryOffset: number): Uint8Array {
    if (entryCount > 0xffff || directorySize > UINT32_MAX || directoryOffset > UINT32_MAX) {
        throw new Error('This folder is too large for this ZIP format.')
    }

    const end = new Uint8Array(22)
    const endView = new DataView(end.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(8, entryCount, true)
    endView.setUint16(10, entryCount, true)
    endView.setUint32(12, directorySize, true)
    endView.setUint32(16, directoryOffset, true)
    return end
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
    return crc32Finalize(crc32Update(0xffffffff, data))
}

function crc32Update(initialCrc: number, data: Uint8Array): number {
    let crc = initialCrc
    for (const byte of data) {
        crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    }
    return crc
}

function crc32Finalize(crc: number): number {
    return (crc ^ 0xffffffff) >>> 0
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
