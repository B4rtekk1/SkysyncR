export function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'

    const total = Math.floor(seconds)
    const hrs = Math.floor(total / 3600)
    const mins = Math.floor((total % 3600) / 60)
    const secs = total % 60

    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }

    return `${mins}:${String(secs).padStart(2, '0')}`
}

export function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}
