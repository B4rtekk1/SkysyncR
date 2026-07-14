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

type PdfSearchResult = {
    pageNumber: number
}

type PdfSearchHighlight = {
    height: number
    left: number
    top: number
    width: number
}

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
    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const textLayerRef = useRef<HTMLDivElement | null>(null)
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
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([])
    const [activeSearchResult, setActiveSearchResult] = useState(0)
    const [searchHighlights, setSearchHighlights] = useState<PdfSearchHighlight[]>([])

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
        const query = searchQuery.trim().toLocaleLowerCase()
        if (!pdf || !query) {
            queueMicrotask(() => {
                setSearchResults([])
                setActiveSearchResult(0)
            })
            return
        }

        let cancelled = false

        void Promise.all(
            Array.from({ length: pdf.numPages }, async (_, index) => {
                const pageNumber = index + 1
                const page = await pdf.getPage(pageNumber)
                const textContent = await page.getTextContent()
                const text = textContent.items
                    .map((entry) => ('str' in entry ? entry.str : ''))
                    .join(' ')
                    .toLocaleLowerCase()

                const matches: PdfSearchResult[] = []
                let startIndex = 0
                while (startIndex !== -1) {
                    startIndex = text.indexOf(query, startIndex)
                    if (startIndex !== -1) {
                        matches.push({ pageNumber })
                        startIndex += query.length
                    }
                }
                return matches
            }),
        ).then((pageMatches) => {
            if (cancelled) return
            const results = pageMatches.flat()
            setSearchResults(results)
            setActiveSearchResult(0)
            if (results[0]) setPageState({ pageNumber: results[0].pageNumber, url })
        }).catch(() => {
            if (!cancelled) setSearchResults([])
        })

        return () => {
            cancelled = true
        }
    }, [pdf, searchQuery, url])

    useEffect(() => {
        function onFindShortcut(event: KeyboardEvent) {
            const isFindShortcut =
                (event.ctrlKey || event.metaKey) &&
                !event.altKey &&
                !event.shiftKey &&
                (event.code === 'KeyF' || event.key.toLowerCase() === 'f')

            if (!isFindShortcut) return

            event.preventDefault()
            event.stopPropagation()
            setIsSearchOpen(true)
            requestAnimationFrame(() => {
                searchInputRef.current?.focus()
                searchInputRef.current?.select()
            })
        }

        window.addEventListener('keydown', onFindShortcut, { capture: true })
        return () => window.removeEventListener('keydown', onFindShortcut, { capture: true })
    }, [])

    useEffect(() => {
        if (!pdf || !canvasRef.current) return

        let cancelled = false
        let textLayer: pdfjs.TextLayer | null = null
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) return

        renderTaskRef.current?.cancel()
        renderTaskRef.current = null
        setSearchHighlights([])

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

                const textLayerContainer = textLayerRef.current
                if (textLayerContainer) {
                    textLayerContainer.replaceChildren()
                    textLayerContainer.style.setProperty('--total-scale-factor', String(viewport.scale))
                    textLayerContainer.style.width = `${viewport.width}px`
                    textLayerContainer.style.height = `${viewport.height}px`

                    void page.getTextContent().then(async (textContent) => {
                        if (cancelled) return

                        textLayer = new pdfjs.TextLayer({
                            container: textLayerContainer,
                            textContentSource: textContent,
                            viewport,
                        })
                        await textLayer.render()
                        if (cancelled) return

                        const searchTerm = searchQuery.trim().toLocaleLowerCase()
                        if (!searchTerm) {
                            setSearchHighlights([])
                            return
                        }

                        const layerBounds = textLayerContainer.getBoundingClientRect()
                        const highlights: PdfSearchHighlight[] = []
                        const highlightPadding = Math.max(1, viewport.scale * 0.75)
                        const walker = document.createTreeWalker(textLayerContainer, NodeFilter.SHOW_TEXT)
                        let textNode = walker.nextNode()

                        while (textNode) {
                            const text = textNode.textContent?.toLocaleLowerCase() ?? ''
                            let matchIndex = text.indexOf(searchTerm)
                            while (matchIndex !== -1) {
                                const range = document.createRange()
                                range.setStart(textNode, matchIndex)
                                range.setEnd(textNode, matchIndex + searchTerm.length)
                                for (const rect of range.getClientRects()) {
                                    highlights.push({
                                        height: rect.height + highlightPadding * 2,
                                        left: rect.left - layerBounds.left - highlightPadding,
                                        top: rect.top - layerBounds.top - highlightPadding,
                                        width: rect.width + highlightPadding * 2,
                                    })
                                }
                                matchIndex = text.indexOf(searchTerm, matchIndex + searchTerm.length)
                            }
                            textNode = walker.nextNode()
                        }
                        setSearchHighlights(highlights)
                    }).catch(() => {
                        if (!cancelled) setSearchHighlights([])
                    })
                }

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
            textLayer?.cancel()
        }
    }, [availableWidth, fitWidth, pageNumber, pdf, rotation, searchQuery, url, zoom])

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

    const selectSearchResult = (nextIndex: number) => {
        if (!searchResults.length) return
        const index = (nextIndex + searchResults.length) % searchResults.length
        setActiveSearchResult(index)
        goToPage(searchResults[index].pageNumber)
    }

    return (
        <div className={`pdf-preview ${pagesHidden ? 'is-pages-hidden' : ''}`} data-pdf-preview="true">
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
                            className={isSearchOpen ? 'is-active' : ''}
                            onClick={() => {
                                setIsSearchOpen(true)
                                requestAnimationFrame(() => searchInputRef.current?.focus())
                            }}
                            aria-label="Search in document"
                            title="Search in document"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                                <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                        </button>
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
                        {isSearchOpen && (
                            <div className="pdf-preview__find" role="search">
                                <input
                                    ref={searchInputRef}
                                    type="search"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault()
                                            selectSearchResult(activeSearchResult + (event.shiftKey ? -1 : 1))
                                        }
                                        if (event.key === 'Escape') setIsSearchOpen(false)
                                    }}
                                    placeholder="Find in document"
                                    aria-label="Find in document"
                                />
                                <output>{searchQuery.trim() ? `${searchResults.length ? activeSearchResult + 1 : 0}/${searchResults.length}` : ''}</output>
                                <button type="button" onClick={() => selectSearchResult(activeSearchResult - 1)} disabled={!searchResults.length} aria-label="Previous result">‹</button>
                                <button type="button" onClick={() => selectSearchResult(activeSearchResult + 1)} disabled={!searchResults.length} aria-label="Next result">›</button>
                                <button type="button" onClick={() => setIsSearchOpen(false)} aria-label="Close search">×</button>
                            </div>
                        )}
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
                        <div className="pdf-preview__canvas-wrap" onDragStart={(event) => event.preventDefault()}>
                            <canvas
                                ref={canvasRef}
                                className="pdf-preview__canvas"
                                draggable={false}
                                aria-label={`Page ${pageNumber} of ${item.filename}`}
                            />
                            <div
                                ref={textLayerRef}
                                className="pdf-preview__text-layer"
                                draggable={false}
                                aria-hidden="true"
                            />
                            <div className="pdf-preview__search-highlights" aria-hidden="true">
                                {searchHighlights.map((highlight, index) => (
                                    <span
                                        key={`${highlight.left}-${highlight.top}-${index}`}
                                        style={{
                                            height: `${highlight.height}px`,
                                            left: `${highlight.left}px`,
                                            top: `${highlight.top}px`,
                                            width: `${highlight.width}px`,
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
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
