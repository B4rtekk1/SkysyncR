import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { Item } from './types'
import { formatBytes } from './fileUtils'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.25
const ROTATION_STEP = 90

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
}

function normalizeRotation(value: number) {
    return ((value % 360) + 360) % 360
}

function PdfPageThumbnail({
    active,
    pageNumber,
    pdf,
    onSelect,
}: {
    active: boolean
    pageNumber: number
    pdf: PDFDocumentProxy
    onSelect: (pageNumber: number) => void
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const renderTaskRef = useRef<RenderTask | null>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const context = canvas.getContext('2d')
        if (!context) return

        let cancelled = false
        renderTaskRef.current?.cancel()
        renderTaskRef.current = null

        pdf.getPage(pageNumber)
            .then((page) => {
                if (cancelled) return null

                const baseViewport = page.getViewport({ scale: 1 })
                const thumbnailWidth = 92
                const scale = thumbnailWidth / baseViewport.width
                const viewport = page.getViewport({ scale })
                const outputScale = window.devicePixelRatio || 1

                canvas.width = Math.floor(viewport.width * outputScale)
                canvas.height = Math.floor(viewport.height * outputScale)
                canvas.style.width = `${Math.floor(viewport.width)}px`
                canvas.style.height = `${Math.floor(viewport.height)}px`

                context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
                context.clearRect(0, 0, viewport.width, viewport.height)

                const renderTask = page.render({ canvas, canvasContext: context, viewport })
                renderTaskRef.current = renderTask
                return renderTask.promise
            })
            .then(() => {
                if (!cancelled) renderTaskRef.current = null
            })
            .catch((renderError) => {
                if (cancelled || renderError?.name === 'RenderingCancelledException') return
                renderTaskRef.current = null
            })

        return () => {
            cancelled = true
            renderTaskRef.current?.cancel()
            renderTaskRef.current = null
        }
    }, [pageNumber, pdf])

    return (
        <button
            type="button"
            className={active ? 'is-active' : ''}
            onClick={() => onSelect(pageNumber)}
            aria-current={active ? 'page' : undefined}
            aria-label={`Go to page ${pageNumber}`}
        >
            <span className="pdf-preview__thumb">
                <canvas ref={canvasRef} aria-hidden="true" />
            </span>
            <em>{pageNumber}</em>
        </button>
    )
}

export function PdfPreview({ item, url }: { item: Item; url: string }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const pageShellRef = useRef<HTMLDivElement | null>(null)
    const renderTaskRef = useRef<RenderTask | null>(null)
    const [pdfState, setPdfState] = useState<{
        error: string | null
        pdf: PDFDocumentProxy | null
        url: string
    }>({ error: null, pdf: null, url })
    const [pageState, setPageState] = useState({ pageNumber: 1, url })
    const [zoom, setZoom] = useState(1)
    const [fitWidth, setFitWidth] = useState(true)
    const [rotation, setRotation] = useState(0)
    const [availableWidth, setAvailableWidth] = useState(0)
    const [rendering, setRendering] = useState(false)
    const [pagesHidden, setPagesHidden] = useState(false)

    const pdf = pdfState.url === url ? pdfState.pdf : null
    const error = pdfState.url === url ? pdfState.error : null
    const loading = !pdf && !error
    const pageNumber = pageState.url === url ? pageState.pageNumber : 1
    const pageCount = pdf?.numPages ?? 0
    const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount])
    const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom])

    useEffect(() => {
        const shell = pageShellRef.current
        if (!shell) return

        const resizeObserver = new ResizeObserver(([entry]) => {
            setAvailableWidth(entry.contentRect.width)
        })
        resizeObserver.observe(shell)

        return () => resizeObserver.disconnect()
    }, [])

    useEffect(() => {
        let cancelled = false
        const task = pdfjs.getDocument({ url })

        task.promise
            .then((loadedPdf) => {
                if (cancelled) return
                setPdfState({ error: null, pdf: loadedPdf, url })
            })
            .catch(() => {
                if (cancelled) return
                setPdfState({ error: 'Could not load this PDF.', pdf: null, url })
            })

        return () => {
            cancelled = true
            void task.destroy()
        }
    }, [url])

    useEffect(() => {
        if (!pdf || !canvasRef.current) return

        let cancelled = false
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) return

        renderTaskRef.current?.cancel()
        renderTaskRef.current = null

        pdf.getPage(pageNumber)
            .then((page) => {
                if (cancelled) return null
                setRendering(true)

                const baseViewport = page.getViewport({ rotation, scale: 1 })
                const shellPadding = 32
                const fittedScale = availableWidth
                    ? clamp((availableWidth - shellPadding) / baseViewport.width, MIN_ZOOM, MAX_ZOOM)
                    : 1
                const renderScale = fitWidth ? fittedScale : zoom
                const viewport = page.getViewport({ rotation, scale: renderScale })
                const outputScale = window.devicePixelRatio || 1

                canvas.width = Math.floor(viewport.width * outputScale)
                canvas.height = Math.floor(viewport.height * outputScale)
                canvas.style.width = `${Math.floor(viewport.width)}px`
                canvas.style.height = `${Math.floor(viewport.height)}px`

                context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
                context.clearRect(0, 0, viewport.width, viewport.height)

                const renderTask = page.render({ canvas, canvasContext: context, viewport })
                renderTaskRef.current = renderTask
                return renderTask.promise
            })
            .then(() => {
                if (!cancelled) {
                    renderTaskRef.current = null
                    setRendering(false)
                }
            })
            .catch((renderError) => {
                if (cancelled || renderError?.name === 'RenderingCancelledException') {
                    return
                }
                renderTaskRef.current = null
                setPdfState({ error: 'Could not render this page.', pdf, url })
                setRendering(false)
            })

        return () => {
            cancelled = true
            renderTaskRef.current?.cancel()
            renderTaskRef.current = null
        }
    }, [availableWidth, fitWidth, pageNumber, pdf, rotation, url, zoom])

    const goToPage = (nextPage: number) => {
        if (!pageCount) return
        setPageState({ pageNumber: clamp(nextPage, 1, pageCount), url })
    }

    const changeZoom = (nextZoom: number) => {
        setFitWidth(false)
        setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM))
    }

    const rotate = (direction: -1 | 1) => {
        setRotation((currentRotation) => normalizeRotation(currentRotation + direction * ROTATION_STEP))
    }

    return (
        <div className={`pdf-preview ${pagesHidden ? 'is-pages-hidden' : ''}`}>
            <div className="pdf-preview__viewer" aria-busy={loading || rendering}>
                <div className="pdf-preview__toolbar" aria-label="PDF controls">
                    <div className="pdf-preview__page-controls">
                        <button
                            type="button"
                            onClick={() => goToPage(pageNumber - 1)}
                            disabled={!pageCount || pageNumber <= 1}
                            aria-label="Previous page"
                            title="Previous page"
                        >
                            <span aria-hidden="true">‹</span>
                        </button>
                        <label>
                            <span>Page</span>
                            <input
                                type="number"
                                min={1}
                                max={pageCount || 1}
                                value={pageNumber}
                                disabled={!pageCount}
                                onChange={(event) => goToPage(Number(event.target.value))}
                            />
                            <em>/ {pageCount || '-'}</em>
                        </label>
                        <button
                            type="button"
                            onClick={() => goToPage(pageNumber + 1)}
                            disabled={!pageCount || pageNumber >= pageCount}
                            aria-label="Next page"
                            title="Next page"
                        >
                            <span aria-hidden="true">›</span>
                        </button>
                    </div>
                    <div className="pdf-preview__zoom-controls">
                        <button
                            type="button"
                            onClick={() => rotate(-1)}
                            disabled={!pageCount}
                            aria-label="Rotate left"
                            title="Rotate left"
                        >
                            <span aria-hidden="true">↺</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => rotate(1)}
                            disabled={!pageCount}
                            aria-label="Rotate right"
                            title="Rotate right"
                        >
                            <span aria-hidden="true">↻</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => changeZoom(zoom - ZOOM_STEP)}
                            disabled={!pageCount || (!fitWidth && zoom <= MIN_ZOOM)}
                            aria-label="Zoom out"
                            title="Zoom out"
                        >
                            <span aria-hidden="true">-</span>
                        </button>
                        <button
                            type="button"
                            className={fitWidth ? 'is-active' : ''}
                            onClick={() => setFitWidth(true)}
                            disabled={!pageCount}
                        >
                            Fit
                        </button>
                        <button
                            type="button"
                            onClick={() => changeZoom(zoom + ZOOM_STEP)}
                            disabled={!pageCount || (!fitWidth && zoom >= MAX_ZOOM)}
                            aria-label="Zoom in"
                            title="Zoom in"
                        >
                            <span aria-hidden="true">+</span>
                        </button>
                        <output>{fitWidth ? 'Fit' : zoomLabel}</output>
                        <button
                            type="button"
                            onClick={() => setPagesHidden((hidden) => !hidden)}
                            aria-controls="pdf-preview-pages-panel"
                            aria-expanded={!pagesHidden}
                            aria-label={pagesHidden ? 'Show page thumbnails' : 'Hide page thumbnails'}
                            title={pagesHidden ? 'Show page thumbnails' : 'Hide page thumbnails'}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M9 4v16M5.5 7h1M5.5 11.5h1M5.5 16h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="pdf-preview__page-shell" ref={pageShellRef}>
                    {(loading || rendering) && (
                        <div className="pdf-preview__status">
                            <span className="spinner" />
                            {loading ? 'Loading PDF...' : 'Rendering page...'}
                        </div>
                    )}
                    {error ? (
                        <div className="pdf-preview__fallback">
                            <p>{error}</p>
                            <a href={url} target="_blank" rel="noreferrer">
                                Open PDF
                            </a>
                        </div>
                    ) : (
                        <canvas
                            ref={canvasRef}
                            className="pdf-preview__canvas"
                            aria-label={`Page ${pageNumber} of ${item.filename}`}
                        />
                    )}
                </div>
            </div>

            <aside id="pdf-preview-pages-panel" className="pdf-preview__side" aria-label="PDF details">
                <section className="pdf-preview__pages" aria-label="Pages">
                    <div className="pdf-preview__side-head">
                        <strong>Pages</strong>
                        <span>{pageCount || '-'}</span>
                    </div>
                    <div className="pdf-preview__page-list">
                        {pages.length ? (
                            pages.map((page) => (
                                pdf ? (
                                    <PdfPageThumbnail
                                    key={page}
                                    active={page === pageNumber}
                                    pageNumber={page}
                                    pdf={pdf}
                                    onSelect={goToPage}
                                />
                                ) : null
                            ))
                        ) : (
                            <p>Loading pages...</p>
                        )}
                    </div>
                </section>

                <dl className="pdf-preview__info">
                    <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(item.size_bytes)}</dd>
                    </div>
                    <div>
                        <dt>Type</dt>
                        <dd>{item.mime_type ?? 'application/pdf'}</dd>
                    </div>
                    <div>
                        <dt>Updated</dt>
                        <dd>{formatDate(item.updated_at)}</dd>
                    </div>
                </dl>
            </aside>
        </div>
    )
}
