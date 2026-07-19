import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Item } from '../types'
import { formatBytes } from '../fileUtils'

const PLAY_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5.8v12.4a1 1 0 0 0 1.55.83l9.3-6.2a1 1 0 0 0 0-1.66l-9.3-6.2A1 1 0 0 0 8 5.8Z" />
    </svg>
)

const PAUSE_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 5.5v13M16 5.5v13" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
)

const VOLUME_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4.5 9.5h3.8L13 5.6v12.8l-4.7-3.9H4.5v-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M16.4 8.4a5 5 0 0 1 0 7.2M18.8 6a8.4 8.4 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

const MUTED_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4.5 9.5h3.8L13 5.6v12.8l-4.7-3.9H4.5v-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="m17.2 9.8 3 3M20.2 9.8l-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
)

const FULLSCREEN_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.5 4.5h-4v4M15.5 4.5h4v4M19.5 15.5v4h-4M4.5 15.5v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

const EXIT_FULLSCREEN_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.5 4.5v4h-4M15.5 4.5v4h4M19.5 15.5h-4v4M4.5 15.5h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const WAVEFORM_BARS = 96
const MAX_WAVEFORM_BYTES = 16 * 1024 * 1024

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

function buildWaveform(audioBuffer: AudioBuffer, bars = WAVEFORM_BARS) {
    const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / bars))
    const levels: number[] = []

    for (let bar = 0; bar < bars; bar += 1) {
        const start = bar * samplesPerBar
        const end = Math.min(audioBuffer.length, start + samplesPerBar)
        let sum = 0
        let count = 0

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
            const data = audioBuffer.getChannelData(channel)
            for (let i = start; i < end; i += 1) {
                sum += (data[i] ?? 0) ** 2
                count += 1
            }
        }

        levels.push(count > 0 ? Math.sqrt(sum / count) : 0)
    }

    const peak = Math.max(...levels, 0.001)
    return levels.map((level) => Math.min(1, level / peak))
}

export function VideoPreviewPlayer({ item, url }: { item: Item; url: string }) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const screenRef = useRef<HTMLDivElement>(null)
    const speedMenuRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const controlsTimerRef = useRef<number | null>(null)
    const volumeHintTimerRef = useRef<number | null>(null)
    const [duration, setDuration] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [volume, setVolume] = useState(0.8)
    const [muted, setMuted] = useState(false)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null)
    const [controlsVisible, setControlsVisible] = useState(true)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
    const [volumeHintVisible, setVolumeHintVisible] = useState(false)
    const [waveform, setWaveform] = useState<number[] | null>(null)

    const durationPct = duration > 0 ? (currentTime / duration) * 100 : 0
    const volumePct = muted ? 0 : volume * 100

    const showControls = useCallback(() => {
        setControlsVisible(true)
        if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current)

        controlsTimerRef.current = window.setTimeout(() => {
            const activeElement = document.activeElement
            const hasFocusInside = activeElement ? screenRef.current?.contains(activeElement) : false
            if (!videoRef.current?.paused && !hasFocusInside) setControlsVisible(false)
        }, 2200)
    }, [])

    const showVolumeHint = useCallback(() => {
        setVolumeHintVisible(true)
        if (volumeHintTimerRef.current) window.clearTimeout(volumeHintTimerRef.current)
        volumeHintTimerRef.current = window.setTimeout(() => setVolumeHintVisible(false), 900)
    }, [])

    const drawAudioGraph = useCallback((levels: number[] | null, time: number, totalDuration: number) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        const width = Math.max(1, Math.floor(rect.width * dpr))
        const height = Math.max(1, Math.floor(rect.height * dpr))

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
        }

        ctx.clearRect(0, 0, width, height)
        if (!levels?.length) return

        const bars = levels.length
        const gap = 2 * dpr
        const barWidth = Math.max(1.5 * dpr, (width - gap * (bars - 1)) / bars)
        const progress = totalDuration > 0 ? Math.min(Math.max(time / totalDuration, 0), 1) : 0

        for (let i = 0; i < bars; i += 1) {
            const barHeight = Math.max(3 * dpr, (levels[i] ?? 0) * height)
            const x = i * (barWidth + gap)
            const y = height - barHeight
            const isPlayed = i / bars <= progress

            ctx.fillStyle = isPlayed ? 'rgba(76, 211, 194, 0.92)' : 'rgba(246, 248, 251, 0.32)'
            ctx.fillRect(x, y, barWidth, barHeight)
        }
    }, [])

    const togglePlay = async () => {
        const video = videoRef.current
        if (!video) return

        if (video.paused) {
            await video.play()
        } else {
            video.pause()
        }
    }

    const seekTo = (nextTime: number) => {
        const video = videoRef.current
        if (!video || !Number.isFinite(nextTime)) return

        const clamped = Math.min(Math.max(nextTime, 0), duration || video.duration || 0)
        video.currentTime = clamped
        setCurrentTime(clamped)
    }

    const updateVolume = (nextVolume: number) => {
        const video = videoRef.current
        const clamped = Math.min(Math.max(nextVolume, 0), 1)
        if (video) {
            video.volume = clamped
            video.muted = clamped === 0
        }
        setVolume(clamped)
        setMuted(clamped === 0)
        showVolumeHint()
    }

    const toggleMute = () => {
        const video = videoRef.current
        const nextMuted = !muted
        if (video) video.muted = nextMuted
        setMuted(nextMuted)
        showVolumeHint()
    }

    const updateSpeed = (nextRate: number) => {
        const video = videoRef.current
        if (video) video.playbackRate = nextRate
        setPlaybackRate(nextRate)
        setSpeedMenuOpen(false)
        showControls()
    }

    const toggleFullscreen = async () => {
        const screen = screenRef.current
        if (!screen) return

        if (document.fullscreenElement === screen) {
            await document.exitFullscreen()
        } else {
            await screen.requestFullscreen()
        }
    }

    useEffect(() => {
        const video = videoRef.current
        if (!video) return

        video.volume = volume
        video.playbackRate = playbackRate
    }, [playbackRate, volume])

    useEffect(() => {
        return () => {
            if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current)
            if (volumeHintTimerRef.current) window.clearTimeout(volumeHintTimerRef.current)
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        let audioContext: AudioContext | null = null

        const loadWaveform = async () => {
            setWaveform(null)
            if (item.size_bytes > MAX_WAVEFORM_BYTES) {
                setWaveform([])
                return
            }

            const AudioContextCtor =
                window.AudioContext ||
                (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!AudioContextCtor) return

            try {
                const response = await fetch(url, { signal: controller.signal })
                const data = await response.arrayBuffer()
                if (controller.signal.aborted) return

                audioContext = new AudioContextCtor()
                const audioBuffer = await audioContext.decodeAudioData(data)
                if (!controller.signal.aborted) setWaveform(buildWaveform(audioBuffer))
            } catch {
                if (!controller.signal.aborted) setWaveform([])
            } finally {
                void audioContext?.close()
            }
        }

        void loadWaveform()

        return () => {
            controller.abort()
            void audioContext?.close()
        }
    }, [item.size_bytes, url])

    useEffect(() => {
        drawAudioGraph(waveform, currentTime, duration)

        const handleResize = () => drawAudioGraph(waveform, currentTime, duration)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [currentTime, drawAudioGraph, duration, waveform])

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === screenRef.current)
            showControls()
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [showControls])

    useEffect(() => {
        if (!speedMenuOpen) return

        const handlePointerDown = (event: PointerEvent) => {
            if (!speedMenuRef.current?.contains(event.target as Node)) {
                setSpeedMenuOpen(false)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        return () => document.removeEventListener('pointerdown', handlePointerDown)
    }, [speedMenuOpen])

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        showControls()
        if (event.key === 'ArrowLeft') {
            event.preventDefault()
            seekTo(currentTime - 5)
        } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            seekTo(currentTime + 5)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            updateVolume(volume + 0.05)
        } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            updateVolume(volume - 0.05)
        } else if (event.key === ' ') {
            event.preventDefault()
            void togglePlay()
        }
    }

    return (
        <div className="video-viewer" tabIndex={0} onKeyDown={onKeyDown} onFocus={showControls}>
            <div
                ref={screenRef}
                className={`video-viewer__screen ${controlsVisible ? 'has-visible-controls' : 'has-hidden-controls'}`}
                onMouseMove={showControls}
                onMouseLeave={() => {
                    if (isPlaying) setControlsVisible(false)
                }}
            >
                <video
                    ref={videoRef}
                    className="video-viewer__video"
                    src={url}
                    playsInline
                    preload="metadata"
                    aria-label={item.filename}
                    onLoadedMetadata={(event) => {
                        const video = event.currentTarget
                        setDuration(video.duration)
                        setVideoSize(
                            video.videoWidth && video.videoHeight
                                ? { width: video.videoWidth, height: video.videoHeight }
                                : null,
                        )
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onPlay={() => {
                        setIsPlaying(true)
                        showControls()
                    }}
                    onPause={() => {
                        setIsPlaying(false)
                        setControlsVisible(true)
                    }}
                    onEnded={() => setIsPlaying(false)}
                    onClick={() => void togglePlay()}
                />
                <button
                    className={`video-viewer__center-play ${isPlaying ? 'is-playing' : ''}`}
                    type="button"
                    onClick={() => void togglePlay()}
                    aria-label={isPlaying ? 'Pause video' : 'Play video'}
                >
                    {isPlaying ? PAUSE_ICON : PLAY_ICON}
                </button>
                <div className={`video-viewer__volume-hint ${volumeHintVisible ? 'is-visible' : ''}`}>
                    {Math.round(volumePct)}%
                </div>

                <div className="video-viewer__overlay" onMouseDown={(event) => event.stopPropagation()}>
                    <canvas className="video-viewer__graph" ref={canvasRef} aria-label="Audio volume graph" />
                    <div className="video-viewer__controls">
                        <div className="video-viewer__timeline-row">
                            <span>{formatTime(currentTime)}</span>
                            <input
                                className="video-viewer__timeline"
                                type="range"
                                min="0"
                                max={duration || 0}
                                step="0.01"
                                value={currentTime}
                                onChange={(event) => seekTo(Number(event.target.value))}
                                aria-label="Seek video"
                                style={{ '--progress': `${durationPct}%` } as CSSProperties}
                            />
                            <span>{formatTime(duration)}</span>
                        </div>

                        <div className="video-viewer__control-grid">
                            <button className="video-viewer__icon-button" type="button" onClick={() => void togglePlay()}>
                                {isPlaying ? PAUSE_ICON : PLAY_ICON}
                            </button>

                            <div className="video-viewer__audio">
                                <button className="video-viewer__icon-button" type="button" onClick={toggleMute}>
                                    {muted || volume === 0 ? MUTED_ICON : VOLUME_ICON}
                                </button>
                                <input
                                    className="video-viewer__volume"
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={volumePct}
                                    onChange={(event) => updateVolume(Number(event.target.value) / 100)}
                                    aria-label="Volume"
                                    style={{ '--progress': `${volumePct}%` } as CSSProperties}
                                />
                            </div>

                            <div className="video-viewer__speed" ref={speedMenuRef}>
                                <span className="video-viewer__speed-label">Speed</span>
                                <button
                                    className={`video-viewer__speed-trigger ${speedMenuOpen ? 'is-open' : ''}`}
                                    type="button"
                                    onClick={() => {
                                        setSpeedMenuOpen((current) => !current)
                                        showControls()
                                    }}
                                    aria-haspopup="listbox"
                                    aria-expanded={speedMenuOpen}
                                    aria-label="Playback speed"
                                >
                                    <strong>{playbackRate}x</strong>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>

                                {speedMenuOpen && (
                                    <div className="video-viewer__speed-menu" role="listbox" aria-label="Playback speed">
                                    {SPEEDS.map((speed) => (
                                        <button
                                            key={speed}
                                            className={`video-viewer__speed-option ${playbackRate === speed ? 'is-selected' : ''}`}
                                            type="button"
                                            role="option"
                                            aria-selected={playbackRate === speed}
                                            onClick={() => updateSpeed(speed)}
                                        >
                                            <span>{speed}x</span>
                                            {playbackRate === speed && (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                    <path d="M5 12.5 9.3 17 19 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                    </div>
                                )}
                            </div>

                            <button
                                className="video-viewer__icon-button"
                                type="button"
                                onClick={() => void toggleFullscreen()}
                                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                            >
                                {isFullscreen ? EXIT_FULLSCREEN_ICON : FULLSCREEN_ICON}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <dl className="video-viewer__info">
                <div>
                    <dt>Duration</dt>
                    <dd>{formatTime(duration)}</dd>
                </div>
                <div>
                    <dt>Resolution</dt>
                    <dd>{videoSize ? `${videoSize.width} x ${videoSize.height}` : 'Unknown'}</dd>
                </div>
                <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(item.size_bytes)}</dd>
                </div>
                <div>
                    <dt>Type</dt>
                    <dd>{item.mime_type ?? 'Video'}</dd>
                </div>
                <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(item.updated_at)}</dd>
                </div>
            </dl>
        </div>
    )
}
