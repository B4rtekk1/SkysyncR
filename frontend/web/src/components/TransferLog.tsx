import { useEffect, useState } from 'react'
import './TransferLog.css'

type Status = 'queued' | 'encrypting' | 'synced'

interface LogRow {
  id: number
  name: string
  size: string
  status: Status
}

const FILES: { name: string; size: string }[] = [
  { name: 'lease_agreement.pdf', size: '212 KB' },
  { name: 'vacation_photo.jpg', size: '4.1 MB' },
  { name: 'budget_q3.xlsx', size: '88 KB' },
  { name: 'project_notes.md', size: '4 KB' },
  { name: 'presentation.pptx', size: '6.7 MB' },
  { name: 'receipt_0892.png', size: '331 KB' },
  { name: 'contract_v2.docx', size: '156 KB' },
]

let rowId = 0

function nextRow(): LogRow {
  const file = FILES[Math.floor(Math.random() * FILES.length)] ?? FILES[0]!
  rowId += 1
  return { id: rowId, name: file.name, size: file.size, status: 'queued' }
}

export default function TransferLog() {
  const [rows, setRows] = useState<LogRow[]>(() => [
    nextRow(),
    nextRow(),
    nextRow(),
    nextRow(),
  ])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const advance = setInterval(() => {
      setRows((prev) => {
        const updated = prev.map((row) => {
          if (row.status === 'queued') return { ...row, status: 'encrypting' as Status }
          if (row.status === 'encrypting') return { ...row, status: 'synced' as Status }
          return row
        })
        const stillSyncing = updated.some((r) => r.status !== 'synced')
        if (!stillSyncing) {
          updated.push(nextRow())
        }
        return updated.slice(-5)
      })
    }, 1400)

    return () => clearInterval(advance)
  }, [])

  return (
    <div className="log" role="group" aria-label="File sync preview (demo)">
      <div className="log__bar">
        <span className="log__dot" />
        <span className="log__dot" />
        <span className="log__dot" />
        <p className="log__title">transfer.log</p>
      </div>
      <div className="log__body">
        {rows.map((row) => (
          <div className="log__row" key={row.id}>
            <span className="log__name">{row.name}</span>
            <span className="log__size">{row.size}</span>
            <span className={`log__status log__status--${row.status}`}>
              {row.status === 'queued' && 'queued'}
              {row.status === 'encrypting' && 'encrypting…'}
              {row.status === 'synced' && 'synced ✓'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
