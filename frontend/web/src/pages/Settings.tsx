import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import '../App.css'
import '../css/dashboard.css'
import '../css/Settings.css'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme, type ThemePreference } from '../hooks/UseTheme'
import { logout } from '../api/auth'
import {
    ApiRequestError,
    changePassword,
    updateUserSettings,
    type CurrentUserResponse,
} from '../api/users'
import { decryptPrivateKey, encryptPrivateKey } from '../crypto/keys'
import { loadEncryptedPrivateKey, storeEncryptedPrivateKey } from '../crypto/storage'
import { NAV_ICONS } from './dashboard/icons'
import {
    NAV_LABELS,
    saveActiveView,
    saveLayoutMode,
} from './dashboard/storage'
import type { ViewKey } from './dashboard/types'
import {
    clearLegacyProfileStorage,
    DEFAULT_SETTINGS,
    loadUserSettings,
    type SettingsState,
} from './settingsPreferences'
import PasswordRequirements from './register/PasswordRequirements'
import { getPasswordRequirements } from './register/passwordRules'

const SETTINGS_ANIMATION_MS = 220
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

const viewOptions: ViewKey[] = ['all', 'favourites', 'shared', 'groups', 'calendar', 'trash']
const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
]

type SettingsModalProps = {
    currentUser: CurrentUserResponse | null
    onClose: () => void
    onSave?: (profile: SettingsState) => void
}

function SettingsModalContent({ currentUser, onClose, onSave }: SettingsModalProps) {
    const [settings, setSettings] = useState<SettingsState>(() => loadUserSettings(currentUser))
    const [saved, setSaved] = useState(false)
    const [closing, setClosing] = useState(false)
    const [avatarError, setAvatarError] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmNewPassword, setConfirmNewPassword] = useState('')
    const [passwordSaving, setPasswordSaving] = useState(false)
    const [passwordSaved, setPasswordSaved] = useState(false)
    const [passwordError, setPasswordError] = useState<string | null>(null)
    const { theme, themePreference, setThemePreference } = useTheme()
    const initials = useMemo(() => {
        const source = settings.displayName || currentUser?.email || 'S'
        return source.trim().charAt(0).toUpperCase()
    }, [settings.displayName, currentUser?.email])

    const requestClose = useCallback(() => {
        setClosing((alreadyClosing) => {
            if (alreadyClosing) return true

            window.setTimeout(onClose, SETTINGS_ANIMATION_MS)
            return true
        })
    }, [onClose])

    useEffect(() => {
        function closeOnEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') requestClose()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [requestClose])

    function updateSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
        setSettings((prev) => ({ ...prev, [key]: value }))
        setSaved(false)
        setSaveError(null)
        if (key === 'avatarUrl') setAvatarError(null)
    }

    function updateAvatar(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return

        if (!file.type.startsWith('image/')) {
            setAvatarError('Choose an image file.')
            return
        }

        if (file.size > MAX_AVATAR_BYTES) {
            setAvatarError('Avatar image must be 2 MB or smaller.')
            return
        }

        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                setAvatarError('Could not read this image.')
                return
            }

            updateSetting('avatarUrl', reader.result)
        }
        reader.onerror = () => setAvatarError('Could not read this image.')
        reader.readAsDataURL(file)
    }

    function clearAvatar() {
        updateSetting('avatarUrl', '')
    }

    function updateTrashRetentionDays(value: string) {
        const parsed = Number.parseInt(value, 10)
        const nextValue = Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : DEFAULT_SETTINGS.trashRetentionDays
        updateSetting('trashRetentionDays', nextValue)
    }

    function showPasswordChangeError(err: unknown) {
        if (err instanceof ApiRequestError && err.status === 401) {
            setPasswordError('Current password is incorrect.')
        } else if (err instanceof ApiRequestError) {
            setPasswordError(err.message)
        } else {
            setPasswordError('Could not change password. Check the current password and try again.')
        }
    }

    async function saveSettings() {
        try {
            const settingsToSave = { ...settings }
            if (currentUser) {
                const savedRemote = await updateUserSettings({
                    display_name: settingsToSave.displayName,
                    avatar_url: settingsToSave.avatarUrl,
                    default_view: settingsToSave.defaultView,
                    layout_mode: settingsToSave.layoutMode,
                    upload_protection: settingsToSave.uploadProtection,
                    compact_metadata: settingsToSave.compactMetadata,
                    device_lock: settingsToSave.deviceLock,
                    sync_on_metered: settingsToSave.syncOnMetered,
                    trash_retention_days: settingsToSave.trashRetentionDays,
                })
                settingsToSave.displayName = savedRemote.display_name ?? ''
                settingsToSave.avatarUrl = savedRemote.avatar_url ?? ''
                settingsToSave.defaultView = savedRemote.default_view as ViewKey
                settingsToSave.layoutMode = savedRemote.layout_mode === 'list' ? 'list' : 'grid'
                settingsToSave.uploadProtection = savedRemote.upload_protection
                settingsToSave.compactMetadata = savedRemote.compact_metadata
                settingsToSave.deviceLock = savedRemote.device_lock
                settingsToSave.syncOnMetered = savedRemote.sync_on_metered
                settingsToSave.trashRetentionDays = savedRemote.trash_retention_days
                setSettings(settingsToSave)
            }
            clearLegacyProfileStorage()
            saveActiveView(settingsToSave.defaultView)
            saveLayoutMode(settingsToSave.layoutMode)
            onSave?.({
                displayName: settingsToSave.displayName,
                avatarUrl: settingsToSave.avatarUrl,
                defaultView: settingsToSave.defaultView,
                layoutMode: settingsToSave.layoutMode,
                uploadProtection: settingsToSave.uploadProtection,
                compactMetadata: settingsToSave.compactMetadata,
                deviceLock: settingsToSave.deviceLock,
                syncOnMetered: settingsToSave.syncOnMetered,
                trashRetentionDays: settingsToSave.trashRetentionDays,
            })
            setSaved(true)
        } catch {
            setSaved(false)
            setSaveError('Could not save settings.')
        }
    }

    async function savePassword() {
        setPasswordError(null)
        setPasswordSaved(false)

        if (!currentUser) {
            setPasswordError('Sign in again before changing your password.')
            return
        }
        if (!currentPassword || !newPassword || !confirmNewPassword) {
            setPasswordError('Fill in all password fields.')
            return
        }
        if (newPassword !== confirmNewPassword) {
            setPasswordError('New passwords do not match.')
            return
        }
        if (currentPassword === newPassword) {
            setPasswordError('Choose a password different from the current one.')
            return
        }
        if (getPasswordRequirements(newPassword).some((requirement) => !requirement.met)) {
            setPasswordError('New password does not meet the password policy.')
            return
        }

        setPasswordSaving(true)
        try {
            const previousEncryptedPrivateKey = await loadEncryptedPrivateKey(currentUser.id)
            if (!previousEncryptedPrivateKey) {
                setPasswordError('This browser does not have the encrypted private key for this account.')
                return
            }

            const exportablePrivateKey = await decryptPrivateKey(previousEncryptedPrivateKey, currentPassword, true)
            const nextEncryptedPrivateKey = await encryptPrivateKey(exportablePrivateKey, newPassword)
            await storeEncryptedPrivateKey(currentUser.id, nextEncryptedPrivateKey)

            try {
                await changePassword({
                    current_password: currentPassword,
                    new_password: newPassword,
                })
            } catch (err) {
                await storeEncryptedPrivateKey(currentUser.id, previousEncryptedPrivateKey)
                showPasswordChangeError(err)
                return
            }

            setCurrentPassword('')
            setNewPassword('')
            setConfirmNewPassword('')
            setPasswordSaved(true)
        } catch (err) {
            showPasswordChangeError(err)
        } finally {
            setPasswordSaving(false)
        }
    }

    async function signOut() {
        await logout()
        window.location.href = '/login'
    }

    return (
        <div
            className={`settings-modal ${closing ? 'is-closing' : ''}`}
            role="presentation"
            onMouseDown={requestClose}
        >
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
                        <button className="settings-close" type="button" onClick={requestClose} aria-label="Close settings">
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
                                <span className="settings-badge">Synced</span>
                            </div>
                            <div className="settings-profile">
                                <div className="settings-profile__avatar">
                                    {settings.avatarUrl ? (
                                        <img src={settings.avatarUrl} alt="" />
                                    ) : (
                                        initials
                                    )}
                                </div>
                                <div className="settings-profile__fields">
                                    <div className="settings-avatar-actions">
                                        <label className="btn btn--outline settings-avatar-picker">
                                            Choose avatar
                                            <input type="file" accept="image/*" onChange={updateAvatar} />
                                        </label>
                                        <button
                                            className="btn btn--outline"
                                            type="button"
                                            onClick={clearAvatar}
                                            disabled={!settings.avatarUrl}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                    {avatarError && <p className="settings-error">{avatarError}</p>}
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
                                        <input value={currentUser?.email ?? 'Unavailable'} readOnly />
                                    </label>
                                </div>
                            </div>
                        </section>

                        <section className="settings-panel settings-panel--wide">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Password</p>
                                    <h2>Change password</h2>
                                </div>
                                {passwordSaved && <span className="settings-badge">Updated</span>}
                            </div>
                            <form
                                className="settings-password-form"
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    void savePassword()
                                }}
                            >
                                <label className="settings-field">
                                    <span>Current password</span>
                                    <input
                                        type="password"
                                        autoComplete="current-password"
                                        value={currentPassword}
                                        onChange={(e) => {
                                            setCurrentPassword(e.target.value)
                                            setPasswordError(null)
                                            setPasswordSaved(false)
                                        }}
                                    />
                                </label>
                                <label className="settings-field">
                                    <span>New password</span>
                                    <input
                                        type="password"
                                        autoComplete="new-password"
                                        value={newPassword}
                                        onChange={(e) => {
                                            setNewPassword(e.target.value)
                                            setPasswordError(null)
                                            setPasswordSaved(false)
                                        }}
                                    />
                                </label>
                                {newPassword.length > 0 && <PasswordRequirements password={newPassword} />}
                                <label className="settings-field">
                                    <span>Confirm new password</span>
                                    <input
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmNewPassword}
                                        onChange={(e) => {
                                            setConfirmNewPassword(e.target.value)
                                            setPasswordError(null)
                                            setPasswordSaved(false)
                                        }}
                                    />
                                </label>
                                {passwordError && <p className="settings-error">{passwordError}</p>}
                                <button
                                    className="btn btn--outline"
                                    type="submit"
                                    disabled={passwordSaving}
                                >
                                    {passwordSaving ? 'Changing...' : 'Change password'}
                                </button>
                            </form>
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

                        <section className="settings-panel">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Appearance</p>
                                    <h2>Theme</h2>
                                </div>
                                <span className="settings-badge">{theme}</span>
                            </div>
                            <div className="settings-segment settings-segment--theme" role="group" aria-label="Theme preference">
                                {themeOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        className={themePreference === option.value ? 'is-active' : ''}
                                        type="button"
                                        onClick={() => setThemePreference(option.value)}
                                        aria-pressed={themePreference === option.value}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <p className="settings-muted">System follows your operating system appearance.</p>
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
                                <label className="settings-retention">
                                    <span>
                                        <strong>Trash retention</strong>
                                        <small>Files in trash are permanently deleted after this many days.</small>
                                    </span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={settings.trashRetentionDays}
                                        onChange={(e) => updateTrashRetentionDays(e.target.value)}
                                        aria-label="Trash retention days"
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
                            <p className="settings-muted">Sign out on this device and end the active session.</p>
                            <button className="btn btn--outline" type="button" onClick={signOut}>
                                Sign out
                            </button>
                        </section>
                    </div>

                    <div className="settings-actions">
                        {saveError && <p className="settings-error">{saveError}</p>}
                        <button className="btn btn--outline" type="button" onClick={requestClose}>
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

function SettingsModal(props: SettingsModalProps) {
    return <SettingsModalContent key={props.currentUser?.id ?? 'anonymous'} {...props} />
}

export default SettingsModal
