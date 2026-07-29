import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import '../../../css/dashboard/preview-sheet.css'
import type { Item } from '../types'
import { formatBytes } from '../fileUtils'

const MAX_PREVIEW_ROWS = 200
const MAX_PREVIEW_COLUMNS = 50

type SheetCell = string | number | boolean | Date | null
type ParsedSheet = {
    name: string
    rows: string[][]
    truncatedRows: boolean
    truncatedColumns: boolean
}

type ParseState =
    | { status: 'loading' }
    | { status: 'ready'; sheets: ParsedSheet[] }
    | { status: 'error'; message: string }

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

function getExtension(filename: string) {
    const ext = filename.split('.').pop()?.trim().toLowerCase()
    return ext ? `.${ext}` : 'sheet'
}

function formatCellValue(value: SheetCell) {
    if (value === null || value === undefined) return ''
    if (value instanceof Date) return value.toLocaleString()
    return String(value)
}

async function parseWorkbook(url: string): Promise<ParsedSheet[]> {
    const response = await fetch(url)
    const data = await response.arrayBuffer()
    const workbook = XLSX.read(data, { type: 'array', cellDates: true })

    return workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name]
        const rawRows = worksheet
            ? XLSX.utils.sheet_to_json<SheetCell[]>(worksheet, {
                  header: 1,
                  blankrows: false,
                  defval: '',
              })
            : []
        const rowLimit = Math.min(rawRows.length, MAX_PREVIEW_ROWS)
        const sourceRows = rawRows.slice(0, rowLimit)
        const maxColumnCount = sourceRows.reduce((max, row) => Math.max(max, row.length), 0)
        const columnLimit = Math.min(maxColumnCount, MAX_PREVIEW_COLUMNS)
        const rows = sourceRows.map((row) =>
            Array.from({ length: columnLimit }, (_, index) => formatCellValue(row[index] ?? '')),
        )

        return {
            name,
            rows,
            truncatedRows: rawRows.length > MAX_PREVIEW_ROWS,
            truncatedColumns: maxColumnCount > MAX_PREVIEW_COLUMNS,
        }
    })
}

export function SheetPreview({
    item,
    url,
    onDownload,
}: {
    item: Item
    url: string
    onDownload: (item: Item) => void
}) {
    const extension = getExtension(item.filename)
    const [parseState, setParseState] = useState<ParseState>({ status: 'loading' })
    const [activeSheetName, setActiveSheetName] = useState<string | null>(null)
    const sheets = parseState.status === 'ready' ? parseState.sheets : []
    const activeSheet = useMemo(
        () => sheets.find((sheet) => sheet.name === activeSheetName) ?? sheets[0] ?? null,
        [activeSheetName, sheets],
    )

    useEffect(() => {
        let active = true
        setParseState({ status: 'loading' })
        setActiveSheetName(null)

        parseWorkbook(url)
            .then((parsedSheets) => {
                if (!active) return
                setParseState({ status: 'ready', sheets: parsedSheets })
                setActiveSheetName(parsedSheets[0]?.name ?? null)
            })
            .catch((error: unknown) => {
                if (!active) return
                setParseState({
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Could not read this spreadsheet.',
                })
            })

        return () => {
            active = false
        }
    }, [url])

    return (
        <div className="sheet-preview">
            <div className="sheet-preview__viewer">
                {parseState.status === 'loading' && (
                    <div className="image-preview__loading">
                        <span className="spinner" />
                        Reading spreadsheet...
                    </div>
                )}

                {parseState.status === 'error' && (
                    <div className="sheet-preview__fallback">
                        <strong>Preview unavailable</strong>
                        <p>{parseState.message}</p>
                        <button className="btn btn--solid" type="button" onClick={() => onDownload(item)}>
                            Download spreadsheet
                        </button>
                    </div>
                )}

                {parseState.status === 'ready' && !activeSheet && (
                    <div className="sheet-preview__fallback">
                        <strong>Empty spreadsheet</strong>
                        <p>No sheets were found in this {extension} file.</p>
                    </div>
                )}

                {activeSheet && (
                    <div className="sheet-preview__table-wrap">
                        {activeSheet.rows.length === 0 ? (
                            <div className="sheet-preview__fallback">
                                <strong>Empty sheet</strong>
                                <p>This sheet has no visible rows.</p>
                            </div>
                        ) : (
                            <table className="sheet-preview__table">
                                <tbody>
                                    {activeSheet.rows.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                            <th scope="row" className="sheet-preview__row-number">
                                                {rowIndex + 1}
                                            </th>
                                            {row.map((cell, cellIndex) => {
                                                const Tag = rowIndex === 0 ? 'th' : 'td'
                                                return (
                                                    <Tag key={cellIndex} scope={rowIndex === 0 ? 'col' : undefined}>
                                                        {cell}
                                                    </Tag>
                                                )
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            <aside className="sheet-preview__side" aria-label="Spreadsheet details">
                <div className="sheet-preview__badge" aria-hidden="true">
                    <span>{extension.replace('.', '') || 'xls'}</span>
                </div>
                {sheets.length > 1 && (
                    <div className="sheet-preview__tabs" role="tablist" aria-label="Sheets">
                        {sheets.map((sheet) => (
                            <button
                                key={sheet.name}
                                className={sheet.name === activeSheet?.name ? 'is-active' : ''}
                                type="button"
                                role="tab"
                                aria-selected={sheet.name === activeSheet?.name}
                                onClick={() => setActiveSheetName(sheet.name)}
                            >
                                {sheet.name}
                            </button>
                        ))}
                    </div>
                )}
                {activeSheet && (activeSheet.truncatedRows || activeSheet.truncatedColumns) && (
                    <p className="sheet-preview__notice">
                        Showing first {MAX_PREVIEW_ROWS} rows and {MAX_PREVIEW_COLUMNS} columns.
                    </p>
                )}
                <dl className="pdf-preview__info sheet-preview__info">
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
