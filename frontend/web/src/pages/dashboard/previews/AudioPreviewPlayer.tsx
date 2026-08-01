import { useState } from 'react'
import '../../../css/dashboard/preview-audio.css'
import type { Item } from '../types'
import { formatBytes } from '../fileUtils'

function formatTime(seconds: number) {
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

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

export function AudioPreviewPlayer({ item, url }: { item: Item; url: string }) {
    const [duration, setDuration] = useState(0)

    return (
        <div className="audio-viewer">
            <section className="audio-viewer__player" aria-label={`Audio preview for ${item.filename}`}>
                <div className="audio-viewer__art" aria-hidden="true">
                    <svg width="74" height="74" viewBox="0 0 24 24" fill="none">
                        <path d="M9 17V7l8-2v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="7" cy="17" r="2" stroke="currentColor" strokeWidth="1.5" />
                        <circle cx="15" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                </div>
                <div className="audio-viewer__track">
                    <strong title={item.filename}>{item.filename}</strong>
                    <span>{item.mime_type ?? 'Audio file'}</span>
                </div>
                <audio
                    className="audio-viewer__controls"
                    src={url}
                    controls
                    preload="metadata"
                    onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                >
                    Your browser cannot play this audio file.
                </audio>
            </section>

            <dl className="audio-viewer__info">
                <div>
                    <dt>Duration</dt>
                    <dd>{formatTime(duration)}</dd>
                </div>
                <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(item.size_bytes)}</dd>
                </div>
                <div>
                    <dt>Type</dt>
                    <dd>{item.mime_type ?? 'Audio'}</dd>
                </div>
                <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(item.updated_at)}</dd>
                </div>
            </dl>
        </div>
    )
}
