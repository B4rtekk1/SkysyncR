import { useEffect, useMemo, useState } from 'react'
import '../App.css'
import '../css/Dashbord.css'
import '../css/Settings.css'
import ThemeToggle from '../components/ThemeToggle'
import { logout } from '../api/auth'
import { getCurrentUser } from '../api/users'
import { NAV_ICONS } from './dashboard/icons'
import {
    LAYOUT_MODE_STORAGE_KEY,
    NAV_LABELS,
    saveActiveView,
    saveLayoutMode,
} from './dashboard/storage'
import type { LayoutMode, ViewKey } from './dashboard/types'

type SettingsState = {
    displayName: string
    defaultView: ViewKey
    layoutMode: LayoutMode
    uploadProtection: boolean
    compactMetadata: boolean
    deviceLock: boolean
    syncOnMetered: boolean
}

const SETTINGS_STORAGE_KEY = 'settings_preferences'

const DEFAULT_SETTINGS: SettingsState = {
    displayName: '',
    defaultView: 'all',
    layoutMode: 'grid',
    uploadProtection: true,
    compactMetadata: true,
    deviceLock: false,
    syncOnMetered: false,
}

const viewOptions: ViewKey[] = ['all', 'favourites', 'shared', 'groups', 'trash']

type SettingsModalProps = {
    onClose: () => void
}

function loadSettings(): SettingsState {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
        return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SettingsState>) } : DEFAULT_SETTINGS
    } catch {
        return DEFAULT_SETTINGS
    }
}

function SettingsModal({ onClose }: SettingsModalProps) {
    const [settings, setSettings] = useState<SettingsState>(() => loadSettings())
    const [email, setEmail] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const initials = useMemo(() => {
        const source = settings.displayName || email || 'S'
        return source.trim().charAt(0).toUpperCase()
    }, [settings.displayName, email])

    useEffect(() => {
        let active = true
        getCurrentUser()
            .then((user) => {
                if (!active) return
                setEmail(user.email)
                setSettings((prev) => ({
                    ...prev,
                    displayName:
                        prev.displayName ||
                        user.display_name ||
                        localStorage.getItem('display_name') ||
                        sessionStorage.getItem('display_name') ||
                        '',
                }))
            })
            .catch(() => {
                if (!active) return
                setSettings((prev) => ({
                    ...prev,
                    displayName:
                        prev.displayName ||
                        localStorage.getItem('display_name') ||
                        sessionStorage.getItem('display_name') ||
                        '',
                }))
            })

        return () => {
            active = false
        }
    }, [])

    useEffect(() => {
        function closeOnEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [onClose])

    function updateSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
        setSettings((prev) => ({ ...prev, [key]: value }))
        setSaved(false)
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
            localStorage.setItem('display_name', settings.displayName)
            saveActiveView(settings.defaultView)
            saveLayoutMode(settings.layoutMode)
            localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, settings.layoutMode)
            setSaved(true)
        } catch {
            setSaved(false)
        }
    }

    async function signOut() {
        await logout()
        window.location.href = '/login'
    }

    return (
        <div className="settings-modal" role="presentation" onMouseDown={onClose}>
            <section
                className="settings-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="settings-topbar">
                    <div>
                        <p className="eyebrow">
                            <span className="eyebrow__dot" /> account controls
                        </p>
                        <h1 className="shell__title" id="settings-title">Settings</h1>
                    </div>
                    <div className="shell__topbar-actions">
                        {saved && <span className="settings-saved">Saved</span>}
                        <ThemeToggle className="shell__theme-toggle" />
                        <button className="settings-close" type="button" onClick={onClose} aria-label="Close settings">
                            x
                        </button>
                    </div>
                </header>

                <section className="settings-content">
                    <div className="settings-grid">
                        <section className="settings-panel settings-panel--wide">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Profile</p>
                                    <h2>Identity</h2>
                                </div>
                                <span className="settings-badge">Local</span>
                            </div>
                            <div className="settings-profile">
                                <div className="settings-profile__avatar">{initials}</div>
                                <div className="settings-profile__fields">
                                    <label className="settings-field">
                                        <span>Display name</span>
                                        <input
                                            value={settings.displayName}
                                            onChange={(e) => updateSetting('displayName', e.target.value)}
                                            placeholder="Your name"
                                        />
                                    </label>
                                    <label className="settings-field">
                                        <span>Email</span>
                                        <input value={email ?? 'Unavailable'} readOnly />
                                    </label>
                                </div>
                            </div>
                        </section>

                        <section className="settings-panel">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Vault</p>
                                    <h2>Default view</h2>
                                </div>
                            </div>
                            <div className="settings-options">
                                {viewOptions.map((view) => (
                                    <button
                                        key={view}
                                        className={`settings-option ${settings.defaultView === view ? 'is-selected' : ''}`}
                                        type="button"
                                        onClick={() => updateSetting('defaultView', view)}
                                    >
                                        <span className="shell__navicon">{NAV_ICONS[view]}</span>
                                        <span>{NAV_LABELS[view]}</span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="settings-panel">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Layout</p>
                                    <h2>File density</h2>
                                </div>
                            </div>
                            <div className="settings-segment" role="group" aria-label="File layout">
                                <button
                                    className={settings.layoutMode === 'grid' ? 'is-active' : ''}
                                    type="button"
                                    onClick={() => updateSetting('layoutMode', 'grid')}
                                >
                                    Grid
                                </button>
                                <button
                                    className={settings.layoutMode === 'list' ? 'is-active' : ''}
                                    type="button"
                                    onClick={() => updateSetting('layoutMode', 'list')}
                                >
                                    List
                                </button>
                            </div>
                            <label className="settings-check">
                                <input
                                    type="checkbox"
                                    checked={settings.compactMetadata}
                                    onChange={(e) => updateSetting('compactMetadata', e.target.checked)}
                                />
                                <span>Show compact metadata in file cards</span>
                            </label>
                        </section>

                        <section className="settings-panel settings-panel--wide">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Security</p>
                                    <h2>Privacy controls</h2>
                                </div>
                            </div>
                            <div className="settings-toggles">
                                <label className="settings-toggle">
                                    <span>
                                        <strong>Encrypt before upload</strong>
                                        <small>Keep client-side encryption enabled for new files.</small>
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={settings.uploadProtection}
                                        onChange={(e) => updateSetting('uploadProtection', e.target.checked)}
                                    />
                                </label>
                                <label className="settings-toggle">
                                    <span>
                                        <strong>Require device unlock</strong>
                                        <small>Ask for local confirmation before sensitive actions.</small>
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={settings.deviceLock}
                                        onChange={(e) => updateSetting('deviceLock', e.target.checked)}
                                    />
                                </label>
                                <label className="settings-toggle">
                                    <span>
                                        <strong>Sync on metered networks</strong>
                                        <small>Allow uploads while the network may charge for data.</small>
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={settings.syncOnMetered}
                                        onChange={(e) => updateSetting('syncOnMetered', e.target.checked)}
                                    />
                                </label>
                            </div>
                        </section>

                        <section className="settings-panel settings-panel--danger">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Session</p>
                                    <h2>Access</h2>
                                </div>
                            </div>
                            <p className="settings-muted">Sign out on this device and remove active tokens from local storage.</p>
                            <button className="btn btn--outline" type="button" onClick={signOut}>
                                Sign out
                            </button>
                        </section>
                    </div>

                    <div className="settings-actions">
                        <button className="btn btn--outline" type="button" onClick={onClose}>
                            Close
                        </button>
                        <button className="btn btn--solid" type="button" onClick={saveSettings}>
                            Save changes
                        </button>
                    </div>
                </section>
            </section>
        </div>
    )
}

export default SettingsModal
