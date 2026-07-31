export type IntegrityVerificationResult = {
    status: 'verified' | 'missing'
    expectedChecksum: string | null
    actualChecksum: string | null
}

export async function verifyBlobChecksum(blob: Blob, expectedChecksum: string | null): Promise<IntegrityVerificationResult> {
    const normalizedExpected = expectedChecksum?.trim().toLowerCase() ?? null
    if (!normalizedExpected) {
        return {
            status: 'missing',
            expectedChecksum: null,
            actualChecksum: null,
        }
    }
    if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
        throw new Error('Downloaded file has an invalid integrity checksum.')
    }

    const actual = await sha256Hex(blob)
    if (actual !== normalizedExpected) {
        throw new Error('Downloaded file failed integrity verification.')
    }

    return {
        status: 'verified',
        expectedChecksum: normalizedExpected,
        actualChecksum: actual,
    }
}

async function sha256Hex(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
