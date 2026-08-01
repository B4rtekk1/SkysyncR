import { useEffect, useMemo, useState } from 'react'
import { unzipSync, strFromU8 } from 'fflate'
import '../../../css/dashboard/preview-document.css'
import type { Item } from '../types'
import { formatBytes } from '../fileUtils'

const MAX_PARAGRAPHS = 260
const PAGE_TEXT_BUDGET = 2600

type DocumentBlock = {
    kind: 'heading' | 'paragraph'
    text: string
}

type ParsedDocument = {
    blocks: DocumentBlock[]
    truncated: boolean
}

type ParseState =
    | { status: 'loading'; url: string }
    | { status: 'ready'; document: ParsedDocument; url: string }
    | { status: 'error'; message: string; url: string }

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

function getExtension(filename: string) {
    const ext = filename.split('.').pop()?.trim().toLowerCase()
    return ext ? `.${ext}` : 'document'
}

function isDocxFile(filename: string, mime: string | null) {
    const normalizedMime = mime?.toLowerCase() ?? ''
    return filename.toLowerCase().endsWith('.docx') || normalizedMime.includes('wordprocessingml')
}

function isOdtFile(filename: string, mime: string | null) {
    const normalizedMime = mime?.toLowerCase() ?? ''
    return filename.toLowerCase().endsWith('.odt') || normalizedMime === 'application/vnd.oasis.opendocument.text'
}

function isLegacyWordFile(filename: string, mime: string | null) {
    const normalizedMime = mime?.toLowerCase() ?? ''
    return filename.toLowerCase().endsWith('.doc') || normalizedMime === 'application/msword'
}

function textContent(node: Element): string {
    return Array.from(node.childNodes)
        .map((child): string => {
            if (child.nodeType === Node.TEXT_NODE) return child.textContent ?? ''
            if (!(child instanceof Element)) return ''

            const localName = child.localName.toLowerCase()
            if (localName === 'tab') return '\t'
            if (localName === 'br' || localName === 'line-break') return '\n'
            return textContent(child)
        })
        .join('')
}

function parseXml(xml: string) {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    const parserError = parsed.querySelector('parsererror')
    if (parserError) throw new Error('The document XML is malformed.')
    return parsed
}

function readZipEntry(zip: Record<string, Uint8Array>, path: string) {
    const entry = zip[path]
    return entry ? strFromU8(entry) : null
}

function blockLimit(blocks: DocumentBlock[]): ParsedDocument {
    return {
        blocks: blocks.slice(0, MAX_PARAGRAPHS),
        truncated: blocks.length > MAX_PARAGRAPHS,
    }
}

function splitIntoPages(blocks: DocumentBlock[]) {
    const pages: DocumentBlock[][] = []
    let currentPage: DocumentBlock[] = []
    let currentLength = 0

    blocks.forEach((block) => {
        const blockLength = block.text.length + (block.kind === 'heading' ? 320 : 80)
        const startsNewPage = currentPage.length > 0 && currentLength + blockLength > PAGE_TEXT_BUDGET

        if (startsNewPage) {
            pages.push(currentPage)
            currentPage = []
            currentLength = 0
        }

        currentPage.push(block)
        currentLength += blockLength
    })

    if (currentPage.length > 0) pages.push(currentPage)
    return pages
}

function parseDocx(arrayBuffer: ArrayBuffer): ParsedDocument {
    const zip = unzipSync(new Uint8Array(arrayBuffer))
    const documentXml = readZipEntry(zip, 'word/document.xml')
    if (!documentXml) throw new Error('Could not find document content in this Word file.')

    const xml = parseXml(documentXml)
    const blocks = Array.from(xml.getElementsByTagNameNS('*', 'p'))
        .map((paragraph): DocumentBlock | null => {
            const text = textContent(paragraph).replace(/\s+\n/g, '\n').trim()
            if (!text) return null

            const style = paragraph.getElementsByTagNameNS('*', 'pStyle')[0]
            const styleValue = style?.getAttribute('w:val') ?? style?.getAttribute('val') ?? ''
            const kind = /heading|title|nag/i.test(styleValue) ? 'heading' : 'paragraph'
            return { kind, text }
        })
        .filter((block): block is DocumentBlock => Boolean(block))

    return blockLimit(blocks)
}

function parseOdt(arrayBuffer: ArrayBuffer): ParsedDocument {
    const zip = unzipSync(new Uint8Array(arrayBuffer))
    const contentXml = readZipEntry(zip, 'content.xml')
    if (!contentXml) throw new Error('Could not find document content in this ODT file.')

    const xml = parseXml(contentXml)
    const paragraphBlocks = Array.from(xml.getElementsByTagNameNS('*', 'p')).map((paragraph): DocumentBlock | null => {
        const text = textContent(paragraph).trim()
        return text ? { kind: 'paragraph', text } : null
    })
    const headingBlocks = Array.from(xml.getElementsByTagNameNS('*', 'h')).map((heading): DocumentBlock | null => {
        const text = textContent(heading).trim()
        return text ? { kind: 'heading', text } : null
    })

    return blockLimit([...headingBlocks, ...paragraphBlocks].filter((block): block is DocumentBlock => Boolean(block)))
}

async function parseDocument(url: string, item: Item): Promise<ParsedDocument> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()

    if (isDocxFile(item.filename, item.mime_type)) return parseDocx(arrayBuffer)
    if (isOdtFile(item.filename, item.mime_type)) return parseOdt(arrayBuffer)
    if (isLegacyWordFile(item.filename, item.mime_type)) {
        throw new Error('This is an older Word .doc file. Preview works for .docx and .odt files; download it to view the original.')
    }

    throw new Error('Preview is available for .docx and .odt documents. Download this file to view it.')
}

export function DocumentPreview({
    item,
    url,
    onDownload,
}: {
    item: Item
    url: string
    onDownload: (item: Item) => void
}) {
    const extension = getExtension(item.filename)
    const [parseState, setParseState] = useState<ParseState>({ status: 'loading', url })
    const parseStatus = parseState.url === url ? parseState.status : 'loading'
    const document = useMemo(
        () => (parseState.status === 'ready' && parseState.url === url ? parseState.document : null),
        [parseState, url],
    )
    const pages = useMemo(() => splitIntoPages(document?.blocks ?? []), [document])

    useEffect(() => {
        let active = true

        parseDocument(url, item)
            .then((parsedDocument) => {
                if (!active) return
                setParseState({ status: 'ready', document: parsedDocument, url })
            })
            .catch((error: unknown) => {
                if (!active) return
                setParseState({
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Could not read this document.',
                    url,
                })
            })

        return () => {
            active = false
        }
    }, [item, url])

    return (
        <div className="document-preview">
            <div className="document-preview__viewer">
                {parseStatus === 'loading' && (
                    <div className="image-preview__loading">
                        <span className="spinner" />
                        Reading document...
                    </div>
                )}

                {parseState.url === url && parseState.status === 'error' && (
                    <div className="document-preview__fallback">
                        <strong>Preview unavailable</strong>
                        <p>{parseState.message}</p>
                        <button className="btn btn--solid" type="button" onClick={() => onDownload(item)}>
                            Download document
                        </button>
                    </div>
                )}

                {document && (
                    <div className="document-preview__pages" aria-label={`Document preview of ${item.filename}`}>
                        {pages.length ? (
                            pages.map((pageBlocks, pageIndex) => (
                                <article
                                    className="document-preview__page"
                                    key={pageIndex}
                                    aria-label={`Page ${pageIndex + 1} of ${item.filename}`}
                                >
                                    {pageBlocks.map((block, blockIndex) =>
                                        block.kind === 'heading' ? (
                                            <h2 key={`${pageIndex}-${blockIndex}-${block.text}`}>{block.text}</h2>
                                        ) : (
                                            <p key={`${pageIndex}-${blockIndex}-${block.text}`}>{block.text}</p>
                                        ),
                                    )}
                                </article>
                            ))
                        ) : (
                            <article className="document-preview__page" aria-label={`Document preview of ${item.filename}`}>
                                <p className="document-preview__empty">This document has no readable text.</p>
                            </article>
                        )}
                    </div>
                )}
            </div>

            <aside className="document-preview__side" aria-label="Document details">
                <div className="document-preview__badge" aria-hidden="true">
                    <span>{extension.replace('.', '') || 'doc'}</span>
                </div>
                {document?.truncated && (
                    <p className="document-preview__notice">Showing the first {MAX_PARAGRAPHS} text blocks.</p>
                )}
                <dl className="pdf-preview__info document-preview__info">
                    <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(item.size_bytes)}</dd>
                    </div>
                    <div>
                        <dt>Type</dt>
                        <dd>{item.mime_type ?? extension}</dd>
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
