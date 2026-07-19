import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { COPY_ICON } from './icons'
import {
    applyPythonCompletion,
    getPythonKeywordCompletion,
    type PythonCompletion,
    type PythonCompletionItem,
} from './pythonCompletion'
import { highlightPython } from './pythonHighlight'
import { checkPythonTypes, type PythonTypeDiagnostic } from './pythonTypeCheck'
import type { Item } from './types'
import type { TextPreviewMode } from './useTextFilePreview'

const MarkdownPreview = lazy(() => import('./MarkdownPreview').then((module) => ({ default: module.MarkdownPreview })))
const INDENT_WIDTH = 4

function MarkdownFallback() {
    return (
        <div className="image-preview__loading">
            <span className="spinner" />
            Loading Markdown preview...
        </div>
    )
}

function getCompletionPosition(textarea: HTMLTextAreaElement) {
    const style = window.getComputedStyle(textarea)
    const mirror = document.createElement('div')
    const span = document.createElement('span')
    const properties = [
        'borderBottomWidth',
        'borderLeftWidth',
        'borderRightWidth',
        'borderTopWidth',
        'boxSizing',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'height',
        'letterSpacing',
        'lineHeight',
        'overflowWrap',
        'paddingBottom',
        'paddingLeft',
        'paddingRight',
        'paddingTop',
        'tabSize',
        'textTransform',
        'whiteSpace',
        'width',
        'wordBreak',
    ] as const

    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.overflowWrap = 'anywhere'
    properties.forEach((property) => {
        mirror.style[property] = style[property]
    })

    mirror.textContent = textarea.value.slice(0, textarea.selectionStart)
    span.textContent = textarea.value.slice(textarea.selectionStart, textarea.selectionStart + 1) || ' '
    mirror.append(span)
    textarea.parentElement?.append(mirror)

    const left = Math.min(Math.max(span.offsetLeft - textarea.scrollLeft, 12), textarea.clientWidth - 210)
    const top = Math.min(Math.max(span.offsetTop - textarea.scrollTop + parseFloat(style.lineHeight), 12), textarea.clientHeight - 190)
    mirror.remove()

    return { left, top }
}

function renderPythonHighlight(text: string) {
    const lines = text.split('\n')
    const indentLevels = lines.map((line) => {
        const indentText = line.match(/^[\t ]*/)?.[0] ?? ''
        return Math.floor(
            Array.from(indentText).reduce(
                (level, character) => level + (character === '\t' ? 1 : 1 / INDENT_WIDTH),
                0,
            ),
        )
    })

    return lines.map((line, lineIndex) => {
        const guideLevel = indentLevels[lineIndex] ?? 0
        const guides = Array.from({ length: guideLevel }, (_, index) => {
            const level = index + 1

            return (
                <span
                    className="syntax-indent-guide"
                    key={`guide-${level}`}
                    style={{ '--indent-guide-level': level.toString() } as CSSProperties}
                />
            )
        })
        const lineNodes: ReactNode[] = highlightPython(line).map((token, tokenIndex) => (
            <span className={`syntax-token syntax-token--${token.type}`} key={tokenIndex}>
                {token.text}
            </span>
        ))

        return (
            <span
                className="syntax-line"
                key={lineIndex}
                style={{ '--indent-level': guideLevel.toString() } as CSSProperties}
            >
                {guides}
                {lineNodes.length > 0 ? lineNodes : ' '}
            </span>
        )
    })
}

function PythonTypeDiagnostics({ diagnostics }: { diagnostics: PythonTypeDiagnostic[] }) {
    if (diagnostics.length === 0) {
        return null
    }

    return (
        <div className="image-preview__type-diagnostics" aria-live="polite">
            <strong>Python type warnings</strong>
            {diagnostics.map((diagnostic) => (
                <p key={`${diagnostic.line}-${diagnostic.column}-${diagnostic.message}`}>
                    <span>
                        L{diagnostic.line}:C{diagnostic.column}
                    </span>
                    {diagnostic.message}
                </p>
            ))}
        </div>
    )
}

function indentSelection(text: string, selectionStart: number, selectionEnd: number) {
    if (selectionStart === selectionEnd) {
        return {
            nextSelectionEnd: selectionStart + 1,
            nextSelectionStart: selectionStart + 1,
            nextText: `${text.slice(0, selectionStart)}\t${text.slice(selectionEnd)}`,
        }
    }

    const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1
    const selectedText = text.slice(lineStart, selectionEnd)
    const nextSelectedText = selectedText.replace(/^/gm, '\t')
    const added = nextSelectedText.length - selectedText.length

    return {
        nextSelectionEnd: selectionEnd + added,
        nextSelectionStart: selectionStart + 1,
        nextText: `${text.slice(0, lineStart)}${nextSelectedText}${text.slice(selectionEnd)}`,
    }
}

function outdentSelection(text: string, selectionStart: number, selectionEnd: number) {
    const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1
    const selectedText = text.slice(lineStart, selectionEnd)
    let removedBeforeSelection = 0
    let totalRemoved = 0
    let cursor = lineStart
    const nextSelectedText = selectedText.replace(/^( {1,4}|\t)/gm, (indent) => {
        if (cursor < selectionStart) {
            removedBeforeSelection += indent.length
        }
        totalRemoved += indent.length
        cursor += indent.length
        return ''
    })

    return {
        nextSelectionEnd: Math.max(lineStart, selectionEnd - totalRemoved),
        nextSelectionStart: Math.max(lineStart, selectionStart - removedBeforeSelection),
        nextText: `${text.slice(0, lineStart)}${nextSelectedText}${text.slice(selectionEnd)}`,
    }
}

function continuePythonIndent(text: string, selectionStart: number, selectionEnd: number) {
    const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1
    const line = text.slice(lineStart, selectionStart)
    const baseIndent = line.match(/^[ \t]*/)?.[0] ?? ''
    const trimmedLine = line.trimEnd()
    const shouldDedent = /^return\b/.test(trimmedLine.trimStart())
    const nextBaseIndent = shouldDedent ? baseIndent.replace(/(?: {1,4}|\t)$/, '') : baseIndent
    const extraIndent = !shouldDedent && trimmedLine.endsWith(':') ? '\t' : ''
    const insertion = `\n${nextBaseIndent}${extraIndent}`
    const nextCaret = selectionStart + insertion.length

    return {
        nextSelectionEnd: nextCaret,
        nextSelectionStart: nextCaret,
        nextText: `${text.slice(0, selectionStart)}${insertion}${text.slice(selectionEnd)}`,
    }
}

export function TextFilePreviewModeToggle({
    setTextMode,
    textMode,
}: {
    setTextMode: (mode: TextPreviewMode) => void
    textMode: TextPreviewMode
}) {
    return (
        <div className="image-preview__mode-toggle" role="group" aria-label="Markdown preview mode">
            <button
                type="button"
                className={textMode === 'render' ? 'is-active' : ''}
                onClick={() => setTextMode('render')}
                aria-pressed={textMode === 'render'}
            >
                Render
            </button>
            <button
                type="button"
                className={textMode === 'plain' ? 'is-active' : ''}
                onClick={() => setTextMode('plain')}
                aria-pressed={textMode === 'plain'}
            >
                Plain
            </button>
        </div>
    )
}

export function TextFileCopyButton({ item, text }: { item: Item; text: string }) {
    const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null)
    const copyTitle = copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy unavailable' : 'Copy'

    useEffect(() => {
        if (copyStatus === null) {
            return
        }

        const timeout = window.setTimeout(() => setCopyStatus(null), 1400)
        return () => window.clearTimeout(timeout)
    }, [copyStatus])

    const copyText = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopyStatus('copied')
        } catch {
            setCopyStatus('failed')
        }
    }

    return (
        <button
            className="file-card__action file-card__action--download"
            type="button"
            onClick={() => void copyText()}
            aria-label={`Copy ${item.filename}`}
            title={copyTitle}
        >
            {COPY_ICON}
        </button>
    )
}

export function TextFilePreview({
    canHighlightPython,
    canRenderMarkdown,
    text,
    textMode,
}: {
    canHighlightPython: boolean
    canRenderMarkdown: boolean
    text: string
    textMode: TextPreviewMode
}) {
    const typeDiagnostics = canHighlightPython ? checkPythonTypes(text) : []

    if (canRenderMarkdown && textMode === 'render') {
        return (
            <Suspense fallback={<MarkdownFallback />}>
                <MarkdownPreview text={text} />
            </Suspense>
        )
    }

    if (canHighlightPython) {
        return (
            <>
                <pre className="image-preview__text image-preview__text--highlight" tabIndex={0}>
                    {text ? renderPythonHighlight(text) : 'This file is empty.'}
                </pre>
                <PythonTypeDiagnostics diagnostics={typeDiagnostics} />
            </>
        )
    }

    return (
        <pre className="image-preview__text" tabIndex={0}>
            {text || 'This file is empty.'}
        </pre>
    )
}

export function TextFileEditor({
    autosaveStatus,
    canHighlightPython,
    canRenderMarkdown,
    error,
    onChange,
    onSave,
    saving,
    text,
}: {
    autosaveStatus?: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
    canHighlightPython: boolean
    canRenderMarkdown: boolean
    error: string | null
    onChange: (text: string) => void
    onSave: () => void
    saving: boolean
    text: string
}) {
    const highlightRef = useRef<HTMLPreElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [completion, setCompletion] = useState<(PythonCompletion & { left: number; selected: number; top: number }) | null>(null)
    const typeDiagnostics = canHighlightPython ? checkPythonTypes(text) : []
    const autosaveLabel =
        autosaveStatus === 'pending'
            ? 'Autosave pending'
            : autosaveStatus === 'saving'
              ? 'Autosaving...'
              : autosaveStatus === 'saved'
                ? 'Autosaved'
                : autosaveStatus === 'error'
                  ? 'Autosave failed'
                  : null
    const renderHighlightedText = (value: string) => (value ? renderPythonHighlight(value) : null)
    const updateCompletion = (textarea: HTMLTextAreaElement, value: string = textarea.value) => {
        if (!canHighlightPython) {
            setCompletion(null)
            return
        }

        const nextCompletion = getPythonKeywordCompletion(value, textarea.selectionStart)
        if (!nextCompletion) {
            setCompletion(null)
            return
        }

        setCompletion({ ...nextCompletion, ...getCompletionPosition(textarea), selected: 0 })
    }

    const insertCompletion = (item: PythonCompletionItem) => {
        if (!completion || !textareaRef.current) {
            return
        }

        const nextText = applyPythonCompletion(text, completion, item)
        const nextCaret = completion.start + item.label.length
        onChange(nextText)
        setCompletion(null)
        window.requestAnimationFrame(() => {
            textareaRef.current?.focus()
            textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
        })
    }
    const applyIndent = (textarea: HTMLTextAreaElement, outdent: boolean) => {
        const next = outdent
            ? outdentSelection(text, textarea.selectionStart, textarea.selectionEnd)
            : indentSelection(text, textarea.selectionStart, textarea.selectionEnd)

        onChange(next.nextText)
        setCompletion(null)
        window.requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(next.nextSelectionStart, next.nextSelectionEnd)
        })
    }
    const applyNewLine = (textarea: HTMLTextAreaElement) => {
        const next = continuePythonIndent(text, textarea.selectionStart, textarea.selectionEnd)

        onChange(next.nextText)
        setCompletion(null)
        window.requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(next.nextSelectionStart, next.nextSelectionEnd)
        })
    }

    return (
        <div
            className={`image-preview__editor-wrap ${
                canRenderMarkdown ? 'image-preview__editor-wrap--markdown' : ''
            } ${canHighlightPython ? 'image-preview__editor-wrap--highlight' : ''}`}
        >
            <div className="image-preview__editor-pane">
                {canHighlightPython && (
                    <pre className="image-preview__editor-highlight" ref={highlightRef} aria-hidden="true">
                        {renderHighlightedText(text)}
                    </pre>
                )}
                <textarea
                    ref={textareaRef}
                    className={`image-preview__editor ${canHighlightPython ? 'image-preview__editor--highlight' : ''}`}
                    value={text}
                    onChange={(e) => {
                        onChange(e.target.value)
                        updateCompletion(e.currentTarget, e.target.value)
                    }}
                    onClick={(e) => updateCompletion(e.currentTarget)}
                    onScroll={(e) => {
                        if (!highlightRef.current) {
                            return
                        }

                        highlightRef.current.scrollTop = e.currentTarget.scrollTop
                        highlightRef.current.scrollLeft = e.currentTarget.scrollLeft
                        setCompletion((current) =>
                            current ? { ...current, ...getCompletionPosition(e.currentTarget) } : null,
                        )
                    }}
                    onKeyDown={(e) => {
                        if (completion && ['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key)) {
                            e.preventDefault()
                            if (e.key === 'Escape') {
                                setCompletion(null)
                            } else if (e.key === 'ArrowDown') {
                                setCompletion({ ...completion, selected: (completion.selected + 1) % completion.items.length })
                            } else if (e.key === 'ArrowUp') {
                                setCompletion({
                                    ...completion,
                                    selected: (completion.selected - 1 + completion.items.length) % completion.items.length,
                                })
                            } else {
                                const selectedItem = completion.items[completion.selected] ?? completion.items[0]
                                if (selectedItem) {
                                    insertCompletion(selectedItem)
                                }
                            }
                            return
                        }

                        if (canHighlightPython && e.key === 'Enter') {
                            e.preventDefault()
                            applyNewLine(e.currentTarget)
                            return
                        }

                        if (e.key === 'Tab') {
                            e.preventDefault()
                            applyIndent(e.currentTarget, e.shiftKey)
                            return
                        }

                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault()
                            onSave()
                        }
                    }}
                    onKeyUp={(e) => {
                        if (['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key)) {
                            return
                        }

                        updateCompletion(e.currentTarget)
                    }}
                    onBlur={() => window.setTimeout(() => setCompletion(null), 120)}
                    disabled={saving}
                    autoFocus
                    spellCheck={false}
                />
                {completion && (
                    <div
                        className="image-preview__completion"
                        style={{ left: `${completion.left}px`, top: `${completion.top}px` }}
                        role="listbox"
                    >
                        {completion.items.map((item, index) => (
                            <button
                                className={`image-preview__completion-item ${
                                    index === completion.selected ? 'is-active' : ''
                                }`}
                                key={`${item.type}-${item.label}`}
                                type="button"
                                role="option"
                                aria-selected={index === completion.selected}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => insertCompletion(item)}
                            >
                                <span>{item.label}</span>
                                <small>{item.type}</small>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {canRenderMarkdown && (
                <div className="image-preview__editor-pane image-preview__editor-pane--preview" aria-live="polite">
                    <Suspense fallback={<MarkdownFallback />}>
                        <MarkdownPreview text={text} />
                    </Suspense>
                </div>
            )}
            {autosaveLabel && (
                <p className={`image-preview__autosave image-preview__autosave--${autosaveStatus}`}>
                    {autosaveLabel}
                </p>
            )}
            <PythonTypeDiagnostics diagnostics={typeDiagnostics} />
            {error && <p className="image-preview__editor-error">{error}</p>}
        </div>
    )
}
