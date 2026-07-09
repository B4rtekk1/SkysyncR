import { useState } from 'react'
import './VaultPanel.css'

const STATUS_LINES = [
    { label: 'cipher', value: 'AES-256-GCM' },
    { label: 'key', value: 'stored locally' },
]

function LockIcon({ unlocked }: { unlocked: boolean }) {
    return (
        <span className={`lock-icon ${unlocked ? 'is-unlocked' : 'is-locked'}`}>
        <svg className="lock-icon__layer lock-icon__layer--locked" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1.4" fill="currentColor" />
        </svg>
        <svg className="lock-icon__layer lock-icon__layer--unlocked" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1.4" fill="currentColor" />
        </svg>
      </span>
    )
}

export default function VaultPanel() {
    const [unlocked, setUnlocked] = useState(false)

    return (
        <div className="vault">
            <div className={`vault__rings ${unlocked ? 'vault__rings--unlocked' : ''}`}>
                <span className="vault__ring vault__ring--1" />
                <span className="vault__ring vault__ring--2" />
                <span className="vault__ring vault__ring--3" />
                <button
                    type="button"
                    className="vault__core"
                    onClick={() => setUnlocked((v) => !v)}
                    aria-pressed={unlocked}
                    aria-label={unlocked ? 'Lock vault preview' : 'Unlock vault preview'}
                >
                    <LockIcon unlocked={unlocked} />
                </button>
            </div>

            <div className="vault__lines" role="img" aria-label="Visualization of an encrypted file vault">
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
                <p className="vault__line" style={{ animationDelay: '0.54s' }}>
                    <span className="vault__line-label">session</span>
                    <span className="vault__line-value" key={unlocked ? 'unlocked' : 'locked'}>
            {unlocked ? 'vault unlocked' : 'waiting for credentials'}
          </span>
                </p>
            </div>
        </div>
    )
}