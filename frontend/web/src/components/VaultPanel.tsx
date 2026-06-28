import './VaultPanel.css'

const STATUS_LINES = [
  { label: 'cipher', value: 'AES-256-GCM' },
  { label: 'key', value: 'stored locally' },
  { label: 'session', value: 'waiting for credentials' },
]

export default function VaultPanel() {
  return (
    <div className="vault" role="img" aria-label="Visualization of an encrypted file vault">
      <div className="vault__rings">
        <span className="vault__ring vault__ring--1" />
        <span className="vault__ring vault__ring--2" />
        <span className="vault__ring vault__ring--3" />
        <div className="vault__core">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 2a4 4 0 0 0-4 4v3H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm0 2a2 2 0 0 1 2 2v3h-4V6a2 2 0 0 1 2-2Zm0 9a1.5 1.5 0 0 1 .75 2.8l.25 2.2h-2l.25-2.2A1.5 1.5 0 0 1 12 13Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>

      <div className="vault__lines">
        {STATUS_LINES.map((line, i) => (
          <p
            className="vault__line"
            key={line.label}
            style={{ animationDelay: `${0.3 + i * 0.12}s` }}
          >
            <span className="vault__line-label">{line.label}</span>
            <span className="vault__line-value">{line.value}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
