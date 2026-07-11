import type { ApiFile, StorageQuota } from '../../../api/files'
import { kindFromFile, type FileKind } from '../fileUtils'

export function useStorageSummary(quota: StorageQuota | null, storageItems: ApiFile[]) {
    const usedPct = quota ? Math.min(100, Math.round((quota.used_bytes / quota.total_bytes) * 100)) : 0
    const storageStatus = usedPct >= 90 ? 'critical' : usedPct >= 80 ? 'warning' : 'healthy'
    const storageStatusText =
        storageStatus === 'critical'
            ? 'Storage almost full'
            : storageStatus === 'warning'
                ? 'Storage getting full'
                : 'Plenty of room'
    const storageBreakdown = Object.entries(
        storageItems.reduce(
            (acc, item) => {
                const kind = kindFromFile(item.filename, item.mime_type)
                acc[kind] = (acc[kind] ?? 0) + item.size_bytes
                return acc
            },
            {} as Record<FileKind, number>,
        ),
    )
        .map(([kind, bytes]) => ({
            kind: kind as FileKind,
            bytes,
        }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 4)
    const storageBreakdownTotal = storageBreakdown.reduce((sum, item) => sum + item.bytes, 0)

    return {
        usedPct,
        storageStatus,
        storageStatusText,
        storageBreakdown,
        storageBreakdownTotal,
    }
}
