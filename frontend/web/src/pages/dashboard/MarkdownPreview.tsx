import { createElement, type MouseEvent, type ReactNode } from 'react'

type MarkdownBlock =
    | { type: 'heading'; level: number; text: string }
    | { type: 'paragraph'; lines: string[] }
    | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
    | { type: 'blockquote'; lines: string[] }
    | { type: 'code'; code: string }
    | { type: 'container'; align?: MarkdownAlign; blocks: MarkdownBlock[] }
    | { type: 'html'; html: string }
    | { type: 'table'; headers: string[]; rows: string[][] }
    | { type: 'rule' }

type MarkdownAlign = 'left' | 'center' | 'right'

const INLINE_RE =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|!\[[^\]]*]\(https?:\/\/[^) ]+\)|\[[^\]]+]\((?:https?:\/\/|mailto:|#)[^) ]+\))/g
const HTML_TAG_RE = /<\/?[a-z][^>]*>/i
const SAFE_HTML_ELEMENTS = new Set([
    'a',
    'abbr',
    'b',
    'br',
    'cite',
    'code',
    'data',
    'del',
    'details',
    'dfn',
    'div',
    'em',
    'i',
    'img',
    'ins',
    'kbd',
    'mark',
    'q',
    's',
    'samp',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'time',
    'u',
    'var',
])
const SAFE_VOID_HTML_ELEMENTS = new Set(['br', 'img'])
const SAFE_URI_RE = /^(https?:|mailto:|#)/i
const SAFE_IMAGE_URI_RE = /^https?:/i
const SAFE_HTML_ATTRS = new Set(['abbr', 'align', 'alt', 'cite', 'datetime', 'height', 'href', 'src', 'title', 'width'])

type MarkdownListItem = {
    text: string
    checked: boolean | null
}

function parseListItem(text: string): MarkdownListItem {
    const task = /^\[([ xX])]\s+(.+)$/.exec(text)
    if (!task) return { text, checked: null }
    return { text: task[2] ?? '', checked: (task[1] ?? '').toLowerCase() === 'x' }
}

function splitTableRow(line: string) {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
}

function isTableDivider(line: string) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function isHtmlBlockStart(line: string) {
    return /^\s*<(details|summary)\b/i.test(line)
}

function isHtmlBlockEnd(line: string) {
    return /<\/(details|summary)>\s*$/i.test(line)
}

function parseAlign(value: string | null): MarkdownAlign | undefined {
    const align = value?.trim().toLowerCase()
    if (align === 'left' || align === 'center' || align === 'right') return align
    return undefined
}

function getDivBlockAlign(line: string): MarkdownAlign | undefined | null {
    const match = /^\s*<div\b([^>]*)>\s*$/i.exec(line)
    if (!match) return null

    const attrs = match[1] ?? ''
    const quoted = /\balign\s*=\s*(['"])(left|center|right)\1/i.exec(attrs)
    if (quoted) return parseAlign(quoted[2] ?? null) ?? undefined

    const unquoted = /\balign\s*=\s*(left|center|right)(?=\s|$)/i.exec(attrs)
    return parseAlign(unquoted?.[1] ?? null)
}

function isDivBlockEnd(line: string) {
    return /^\s*<\/div>\s*$/i.test(line)
}

function slugHeading(text: string) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
}

function findAnchorTarget(container: HTMLElement, rawHash: string) {
    const id = decodeURIComponent(rawHash.slice(1))
    return Array.from(container.querySelectorAll<HTMLElement>('[id]')).find((element) => element.id === id) ?? null
}

function parseMarkdown(text: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = []
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    let paragraph: string[] = []
    let list: { ordered: boolean; items: MarkdownListItem[] } | null = null
    let quote: string[] = []
    let code: string[] | null = null
    let html: string[] | null = null
    let container: { align?: MarkdownAlign; lines: string[] } | null = null

    function pushContainer(current: { align?: MarkdownAlign; lines: string[] }) {
        const block = { type: 'container' as const, blocks: parseMarkdown(current.lines.join('\n')) }
        blocks.push(current.align ? { ...block, align: current.align } : block)
    }

    function flushParagraph() {
        if (paragraph.length) {
            blocks.push({ type: 'paragraph', lines: paragraph })
            paragraph = []
        }
    }

    function flushList() {
        if (list) {
            blocks.push({ type: 'list', ordered: list.ordered, items: list.items })
            list = null
        }
    }

    function flushQuote() {
        if (quote.length) {
            blocks.push({ type: 'blockquote', lines: quote })
            quote = []
        }
    }

    function flushFlow() {
        flushParagraph()
        flushList()
        flushQuote()
    }

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? ''
        if (container) {
            if (isDivBlockEnd(line)) {
                pushContainer(container)
                container = null
            } else {
                container.lines.push(line)
            }
            continue
        }

        if (code) {
            if (line.startsWith('```')) {
                blocks.push({ type: 'code', code: code.join('\n') })
                code = null
            } else {
                code.push(line)
            }
            continue
        }

        if (html) {
            html.push(line)
            if (isHtmlBlockEnd(line) || !line.trim()) {
                blocks.push({ type: 'html', html: html.join('\n') })
                html = null
            }
            continue
        }

        if (line.startsWith('```')) {
            flushFlow()
            code = []
            continue
        }

        if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1] ?? '')) {
            flushFlow()
            const headers = splitTableRow(line)
            const rows: string[][] = []
            i += 2

            while (i < lines.length && (lines[i] ?? '').trim() && (lines[i] ?? '').includes('|')) {
                rows.push(splitTableRow(lines[i] ?? ''))
                i += 1
            }

            i -= 1
            blocks.push({ type: 'table', headers, rows })
            continue
        }

        if (!line.trim()) {
            flushFlow()
            continue
        }

        if (isHtmlBlockStart(line)) {
            flushFlow()
            html = [line]
            if (isHtmlBlockEnd(line)) {
                blocks.push({ type: 'html', html: html.join('\n') })
                html = null
            }
            continue
        }

        const divAlign = getDivBlockAlign(line)
        if (divAlign !== null) {
            flushFlow()
            container = divAlign ? { align: divAlign, lines: [] } : { lines: [] }
            continue
        }

        const heading = /^(#{1,6})\s+(.+)$/.exec(line)
        if (heading) {
            flushFlow()
            blocks.push({ type: 'heading', level: (heading[1] ?? '').length, text: heading[2] ?? '' })
            continue
        }

        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
            flushFlow()
            blocks.push({ type: 'rule' })
            continue
        }

        const orderedListItem = /^\d+\.\s+(.+)$/.exec(line)
        const unorderedListItem = /^[-*+]\s+(.+)$/.exec(line)
        if (orderedListItem || unorderedListItem) {
            flushParagraph()
            flushQuote()
            const ordered = Boolean(orderedListItem)
            if (!list || list.ordered !== ordered) flushList()
            list = list ?? { ordered, items: [] }
            list.items.push(parseListItem((orderedListItem ?? unorderedListItem)?.[1] ?? ''))
            continue
        }

        const quoteLine = /^>\s?(.*)$/.exec(line)
        if (quoteLine) {
            flushParagraph()
            flushList()
            quote.push(quoteLine[1] ?? '')
            continue
        }

        flushList()
        flushQuote()
        paragraph.push(line.trim())
    }

    if (code) blocks.push({ type: 'code', code: code.join('\n') })
    if (html) blocks.push({ type: 'html', html: html.join('\n') })
    if (container) pushContainer(container)
    flushFlow()
    return blocks
}

function isSafeHref(value: string) {
    return SAFE_URI_RE.test(value.trim())
}

function isSafeImageSrc(value: string) {
    return SAFE_IMAGE_URI_RE.test(value.trim())
}

function getSafeHtmlProps(element: Element) {
    const props: Record<string, string | { textAlign: MarkdownAlign } | undefined> = {}

    for (const { name, value } of Array.from(element.attributes)) {
        const attr = name.toLowerCase()
        if (attr.startsWith('on') || !SAFE_HTML_ATTRS.has(attr)) continue
        if (attr === 'align') {
            const align = parseAlign(value)
            if (align) props.style = { textAlign: align }
            continue
        }
        if ((attr === 'href' || attr === 'cite') && !isSafeHref(value)) continue
        if (attr === 'src' && !isSafeImageSrc(value)) continue
        props[attr === 'datetime' ? 'dateTime' : attr] = value
    }

    if (element.tagName.toLowerCase() === 'a') {
        const href = typeof props.href === 'string' ? props.href : undefined
        if (href && !href.startsWith('#')) {
            props.target = '_blank'
            props.rel = 'noreferrer'
        }
    }

    if (element.tagName.toLowerCase() === 'img') {
        if (!props.src) return {}
        props.loading = 'lazy'
        props.decoding = 'async'
    }

    return props
}

function renderSafeHtmlNode(node: ChildNode, key: string): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return null

    const element = node as Element
    const tagName = element.tagName.toLowerCase()
    const children = Array.from(element.childNodes).map((child, index) => renderSafeHtmlNode(child, `${key}-${index}`))

    if (!SAFE_HTML_ELEMENTS.has(tagName)) return children
    const props = getSafeHtmlProps(element)
    if (tagName === 'img' && !props.src) return null
    if (SAFE_VOID_HTML_ELEMENTS.has(tagName)) return createElement(tagName, { ...props, key })

    return createElement(tagName, { ...props, key }, children)
}

function renderSafeHtml(html: string, keyPrefix: string): ReactNode[] {
    if (!HTML_TAG_RE.test(html) || typeof DOMParser === 'undefined' || typeof Node === 'undefined') return [html]

    const document = new DOMParser().parseFromString(`<template>${html}</template>`, 'text/html')
    const template = document.querySelector('template')
    if (!template) return [html]

    return Array.from(template.content.childNodes).map((node, index) => renderSafeHtmlNode(node, `${keyPrefix}-${index}`))
}

function renderInline(text: string): ReactNode[] {
    const nodes: ReactNode[] = []
    let lastIndex = 0

    for (const match of text.matchAll(INLINE_RE)) {
        const token = match[0]
        const index = match.index ?? 0
        if (index > lastIndex) nodes.push(...renderSafeHtml(text.slice(lastIndex, index), `html-${lastIndex}`))

        if (token.startsWith('`')) {
            nodes.push(<code key={index}>{token.slice(1, -1)}</code>)
        } else if (token.startsWith('**') || token.startsWith('__')) {
            nodes.push(<strong key={index}>{renderInline(token.slice(2, -2))}</strong>)
        } else if (token.startsWith('*') || token.startsWith('_')) {
            nodes.push(<em key={index}>{renderInline(token.slice(1, -1))}</em>)
        } else {
            const image = /^!\[([^\]]*)]\((https?:\/\/[^) ]+)\)$/.exec(token)
            if (image) {
                nodes.push(<img key={index} src={image[2] ?? ''} alt={image[1] ?? ''} loading="lazy" decoding="async" />)
                lastIndex = index + token.length
                continue
            }

            const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
            if (link) {
                const href = link[2] ?? ''
                const isAnchor = href.startsWith('#')
                nodes.push(
                    <a key={index} href={href} target={isAnchor ? undefined : '_blank'} rel={isAnchor ? undefined : 'noreferrer'}>
                        {renderInline(link[1] ?? '')}
                    </a>,
                )
            } else {
                nodes.push(token)
            }
        }

        lastIndex = index + token.length
    }

    if (lastIndex < text.length) nodes.push(...renderSafeHtml(text.slice(lastIndex), `html-${lastIndex}`))
    return nodes
}

function renderListItem(item: MarkdownListItem, itemIndex: number) {
    return (
        <li key={itemIndex} className={item.checked !== null ? 'task-list-item' : undefined}>
            {item.checked !== null && (
                <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-label={item.checked ? 'Completed' : 'Not completed'} />
            )}
            {renderInline(item.text)}
        </li>
    )
}

function renderMarkdownBlock(block: MarkdownBlock, index: number): ReactNode {
    if (block.type === 'heading') {
        return createElement(`h${block.level}`, { id: slugHeading(block.text), key: index }, renderInline(block.text))
    }
    if (block.type === 'paragraph') {
        return <p key={index}>{renderInline(block.lines.join(' '))}</p>
    }
    if (block.type === 'list') {
        const List = block.ordered ? 'ol' : 'ul'
        return (
            <List key={index} className={block.items.some((item) => item.checked !== null) ? 'contains-task-list' : undefined}>
                {block.items.map(renderListItem)}
            </List>
        )
    }
    if (block.type === 'blockquote') {
        return <blockquote key={index}>{renderInline(block.lines.join(' '))}</blockquote>
    }
    if (block.type === 'code') {
        return (
            <pre key={index}>
                <code>{block.code}</code>
            </pre>
        )
    }
    if (block.type === 'container') {
        return (
            <div key={index} style={block.align ? { textAlign: block.align } : undefined}>
                {block.blocks.map(renderMarkdownBlock)}
            </div>
        )
    }
    if (block.type === 'html') {
        return <div key={index}>{renderSafeHtml(block.html, `block-html-${index}`)}</div>
    }
    if (block.type === 'table') {
        return (
            <div className="markdown-preview__table-wrap" key={index}>
                <table>
                    <thead>
                        <tr>
                            {block.headers.map((header, headerIndex) => (
                                <th key={headerIndex}>{renderInline(header)}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {block.rows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                {block.headers.map((_, cellIndex) => (
                                    <td key={cellIndex}>{renderInline(row[cellIndex] ?? '')}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )
    }
    return <hr key={index} />
}

export function MarkdownPreview({ text }: { text: string }) {
    const blocks = parseMarkdown(text)

    function handleAnchorClick(e: MouseEvent<HTMLDivElement>) {
        const link = (e.target as HTMLElement).closest('a')
        const href = link?.getAttribute('href')
        if (!href?.startsWith('#')) return

        const container = e.currentTarget
        const target = findAnchorTarget(container, href)
        if (!target) return

        e.preventDefault()
        target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }

    if (!blocks.length) {
        return <div className="markdown-preview markdown-preview--empty">This file is empty.</div>
    }

    return (
        <div className="markdown-preview" tabIndex={0} onClick={handleAnchorClick}>
            {blocks.map(renderMarkdownBlock)}
        </div>
    )
}
