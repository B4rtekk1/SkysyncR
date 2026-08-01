import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import '../App.css'
import '../css/Settings.css'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme, type ThemePreference } from '../hooks/UseTheme'
import { logout, logoutAllSessions } from '../api/auth'
import { getDeviceLabel, setDeviceLabel } from '../api/http'
import {
    ApiRequestError,
    changePassword,
    downloadUserDataExport,
    getOperationLog,
    getSessions,
    getTotpStatus,
    setupTotp,
    confirmTotp,
    disableTotp,
    revokeSession,
    updateSessionTrust,
    updateUserSettings,
    type CurrentUserResponse,
    type OperationLogEntry,
    type OperationLogResponse,
    type ReauthenticationPayload,
    type SessionsResponse,
} from '../api/users'
import { decryptPrivateKey, encryptPrivateKey } from '../crypto/keys'
import { clearActivePrivateKeys, loadEncryptedPrivateKey, storeEncryptedPrivateKey } from '../crypto/storage'
import { setUnlockedVaultSession } from '../api/session'
import {
    CLOSE_ICON,
    DOWNLOAD_ICON,
    GRID_VIEW_ICON,
    LIST_VIEW_ICON,
    NAV_ICONS,
} from './dashboard/icons'
import {
    NAV_LABELS,
    saveActiveView,
    saveLayoutMode,
} from './dashboard/storage'
import { createQrPath } from './dashboard/qr'
import { describeApproximateLocation } from './dashboard/sessionDisplay'
import type { ViewKey } from './dashboard/types'
import {
    clearLegacyProfileStorage,
    DEFAULT_SETTINGS,
    loadUserSettings,
    type SettingsState,
} from './settingsPreferences'
import PasswordRequirements from './register/PasswordRequirements'
import { getPasswordRequirements } from './register/passwordRules'
import EyeIcon from './login/EyeIcon'
import { useModalA11y } from '../hooks/useModalA11y'

const SETTINGS_ANIMATION_MS = 220
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

const viewOptions: ViewKey[] = ['all', 'favourites', 'shared', 'groups', 'calendar', 'security', 'trash']
const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
]

const PROFILE_SETTINGS_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        <path
            d="M5.5 19.2c.8-3.7 3.2-5.5 6.5-5.5s5.7 1.8 6.5 5.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
    </svg>
)

const SECURITY_SETTINGS_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M12 3.8 18.5 6v5.1c0 4.2-2.5 7.6-6.5 9.1-4-1.5-6.5-4.9-6.5-9.1V6L12 3.8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="m9.2 12 1.9 1.9 3.9-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

const VAULT_SETTINGS_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="6.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 6.5V5.8A2.8 2.8 0 0 1 10.8 3h2.4A2.8 2.8 0 0 1 16 5.8v.7" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12.3" r="1.6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 13.9v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

const SESSIONS_SETTINGS_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="11" height="8.5" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="10" width="6" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 17h4M10 13.5V17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16.3 16.5h1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

const AUDIT_SETTINGS_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4.5h7.4L18 8.1v11.4H7v-15Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M14.2 4.8V8.3h3.5M9.5 12h5M9.5 15h5M9.5 18h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
)

const settingsNavItems = [
    { href: '#settings-profile', label: 'Profile', icon: PROFILE_SETTINGS_ICON },
    { href: '#settings-security', label: 'Security', icon: SECURITY_SETTINGS_ICON },
    { href: '#settings-vault', label: 'Vault', icon: VAULT_SETTINGS_ICON },
    { href: '#settings-sessions', label: 'Sessions', icon: SESSIONS_SETTINGS_ICON },
    { href: '#settings-audit', label: 'Audit log', icon: AUDIT_SETTINGS_ICON },
]

function clearSettingsHash() {
    if (!window.location.hash.startsWith('#settings-')) return

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}

const sessionActionLabels: Record<string, string> = {
    login: 'Signed in',
    refresh: 'Session refreshed',
    logout: 'Signed out',
    logout_all: 'Signed out everywhere',
    revoked: 'Session revoked',
    trust_changed: 'Trusted device changed',
}

const operationLabels: Record<string, string> = {
    'file.upload': 'Uploaded file',
    'file.download': 'Downloaded file',
    'file.rename': 'Renamed file',
    'file.move': 'Moved file',
    'file.update': 'Updated file',
    'file.delete': 'Deleted file',
    'file.restore': 'Restored file',
    'file.version.restore': 'Restored file version',
    'file.share': 'Shared file',
    'file.unshare': 'Stopped sharing file',
    'file.note.update': 'Updated file note',
    'user.login': 'Signed in',
    'user.logout': 'Signed out',
    'user.logout_all': 'Signed out everywhere',
    'user.session.revoke': 'Revoked session',
    'user.settings.update': 'Updated settings',
    'user.password.change': 'Changed password',
    'user.data_export.download': 'Downloaded data export',
}

function safeLogFilenamePart(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'user'
}

function downloadJsonFile(filename: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
}

function buildOperationLogExport(
    currentUser: CurrentUserResponse,
    operations: OperationLogEntry[],
) {
    return {
        exported_at: new Date().toISOString(),
        user: {
            id: currentUser.id,
            email: currentUser.email,
        },
        operations,
    }
}

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
    const [showCurrentPassword, setShowCurrentPassword] = useState(false)
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false)
    const [passwordSaving, setPasswordSaving] = useState(false)
    const [passwordSaved, setPasswordSaved] = useState(false)
    const [passwordError, setPasswordError] = useState<string | null>(null)
    const [confirmLogoutAll, setConfirmLogoutAll] = useState(false)
    const [logoutAllSaving, setLogoutAllSaving] = useState(false)
    const [logoutAllError, setLogoutAllError] = useState<string | null>(null)
    const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(null)
    const [sessionsLoading, setSessionsLoading] = useState(false)
    const [sessionsError, setSessionsError] = useState<string | null>(null)
    const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
    const [trustingSessionId, setTrustingSessionId] = useState<string | null>(null)
    const [currentDeviceLabel, setCurrentDeviceLabel] = useState(() => getDeviceLabel())
    const [operationLog, setOperationLog] = useState<OperationLogResponse | null>(null)
    const [operationLogLoading, setOperationLogLoading] = useState(false)
    const [operationLogError, setOperationLogError] = useState<string | null>(null)
    const [dataExportLoading, setDataExportLoading] = useState(false)
    const [dataExportError, setDataExportError] = useState<string | null>(null)
    const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; pending: boolean } | null>(null)
    const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauth_url: string } | null>(null)
    const [totpCode, setTotpCode] = useState('')
    const [totpSaving, setTotpSaving] = useState(false)
    const [totpError, setTotpError] = useState<string | null>(null)
    const dialogRef = useRef<HTMLElement>(null)
    const { theme, themePreference, setThemePreference } = useTheme()
    const initials = useMemo(() => {
        const source = settings.displayName || currentUser?.email || 'S'
        return source.trim().charAt(0).toUpperCase()
    }, [settings.displayName, currentUser?.email])
    const totpQr = useMemo(() => {
        if (!totpSetup) return null
        try {
            return createQrPath(totpSetup.otpauth_url)
        } catch {
            return null
        }
    }, [totpSetup])
    const totpQrUnavailable = Boolean(totpSetup && !totpQr)

    const requestClose = useCallback(() => {
        setClosing((alreadyClosing) => {
            if (alreadyClosing) return true

            clearSettingsHash()
            window.setTimeout(onClose, SETTINGS_ANIMATION_MS)
            return true
        })
    }, [onClose])

    useModalA11y({ dialogRef, onClose: requestClose })

    useEffect(() => clearSettingsHash, [])

    const loadSessions = useCallback(async () => {
        if (!currentUser) return

        setSessionsLoading(true)
        setSessionsError(null)
        try {
            setSessionsData(await getSessions())
        } catch {
            setSessionsError('Could not load signed-in devices.')
        } finally {
            setSessionsLoading(false)
        }
    }, [currentUser])

    const loadOperationLog = useCallback(async () => {
        if (!currentUser) return

        setOperationLogLoading(true)
        setOperationLogError(null)
        try {
            setOperationLog(await getOperationLog())
        } catch {
            setOperationLogError('Could not load operation log.')
        } finally {
            setOperationLogLoading(false)
        }
    }, [currentUser])

    useEffect(() => {
        void Promise.resolve().then(loadSessions)
    }, [loadSessions])

    useEffect(() => {
        void Promise.resolve().then(loadOperationLog)
    }, [loadOperationLog])

    useEffect(() => {
        void getTotpStatus().then(setTotpStatus).catch(() => setTotpError('Could not load two-factor authentication status.'))
    }, [])

    async function beginTotpSetup() {
        setTotpSaving(true); setTotpError(null)
        try { setTotpSetup(await setupTotp()); setTotpCode('') }
        catch (error) { setTotpError(error instanceof Error ? error.message : 'Could not start two-factor setup.') }
        finally { setTotpSaving(false) }
    }

    async function saveTotp() {
        if (totpCode.length !== 6) { setTotpError('Enter the 6-digit code from your authenticator app.'); return }
        setTotpSaving(true); setTotpError(null)
        try { setTotpStatus(await confirmTotp(totpCode)); setTotpSetup(null); setTotpCode(''); void loadOperationLog() }
        catch (error) { setTotpError(error instanceof Error ? error.message : 'Could not enable two-factor authentication.') }
        finally { setTotpSaving(false) }
    }

    async function removeTotp() {
        if (totpCode.length !== 6) { setTotpError('Enter the current 6-digit code to disable two-factor authentication.'); return }
        setTotpSaving(true); setTotpError(null)
        try { setTotpStatus(await disableTotp(totpCode)); setTotpCode(''); void loadOperationLog() }
        catch (error) { setTotpError(error instanceof Error ? error.message : 'Could not disable two-factor authentication.') }
        finally { setTotpSaving(false) }
    }

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

    function saveCurrentDeviceLabel() {
        setCurrentDeviceLabel(setDeviceLabel(currentDeviceLabel))
        void loadSessions()
        void loadOperationLog()
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
            void loadOperationLog()
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
            void loadOperationLog()
        } catch (err) {
            showPasswordChangeError(err)
        } finally {
            setPasswordSaving(false)
        }
    }

    async function signOut() {
        await logout()
        window.location.assign('/login')
    }

    async function lockVaultNow() {
        setUnlockedVaultSession(null)
        await clearActivePrivateKeys()
        window.location.assign('/login')
    }

    function requestReauthentication(action: string): ReauthenticationPayload | null {
        const password = window.prompt(`Confirm your password to ${action}.`)
        if (!password) return null
        const totpCode = window.prompt('Enter your 6-digit authenticator code if two-factor authentication is enabled.')?.trim()
        return {
            password,
            totp_code: totpCode || null,
        }
    }

    async function signOutEverywhere() {
        setLogoutAllError(null)

        if (!confirmLogoutAll) {
            setConfirmLogoutAll(true)
            return
        }

        setLogoutAllSaving(true)
        try {
            await logoutAllSessions()
            window.location.assign('/login')
        } catch {
            setLogoutAllError('Could not sign out all sessions. Try again.')
            setConfirmLogoutAll(false)
        } finally {
            setLogoutAllSaving(false)
        }
    }

    async function signOutSession(sessionId: string, current: boolean) {
        setSessionsError(null)
        setRevokingSessionId(sessionId)
        try {
            await revokeSession(sessionId)
            if (current) {
                await logout()
                window.location.assign('/login')
                return
            }
            await loadSessions()
            await loadOperationLog()
        } catch {
            setSessionsError('Could not sign out this device. Try again.')
        } finally {
            setRevokingSessionId(null)
        }
    }

    async function toggleTrustedSession(sessionId: string, trusted: boolean) {
        setSessionsError(null)
        setTrustingSessionId(sessionId)
        try {
            await updateSessionTrust(sessionId, trusted)
            await loadSessions()
        } catch {
            setSessionsError('Could not update trusted device. Try again.')
        } finally {
            setTrustingSessionId(null)
        }
    }

    function downloadOperationLog() {
        if (!currentUser || !operationLog?.operations.length) return

        const datePart = new Date().toISOString().slice(0, 10)
        const userPart = safeLogFilenamePart(currentUser.email)
        const payload = buildOperationLogExport(currentUser, operationLog.operations)
        downloadJsonFile(`skysyncr-operation-log-${userPart}-${datePart}.json`, payload)
    }

    async function downloadDataExport() {
        if (!currentUser) return

        setDataExportLoading(true)
        setDataExportError(null)
        try {
            const reauth = requestReauthentication('download your data export')
            if (!reauth) return
            await downloadUserDataExport(reauth)
            void loadOperationLog()
        } catch (error) {
            setDataExportError(error instanceof Error ? error.message : 'Could not prepare data export.')
        } finally {
            setDataExportLoading(false)
        }
    }

    function formatSessionTime(value: string): string {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return 'Unknown time'
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date)
    }

    return (
        <div
            className={`settings-modal ${closing ? 'is-closing' : ''}`}
            role="presentation"
            onMouseDown={requestClose}
        >
            <section
                ref={dialogRef}
                className="settings-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="settings-topbar">
                    <div className="settings-title-group">
                        <p className="eyebrow">
                            account controls
                        </p>
                        <h1 className="shell__title" id="settings-title">Settings</h1>
                        <p className="settings-topbar__copy">Manage your vault defaults, identity, and active sessions.</p>
                    </div>
                    <div className="shell__topbar-actions">
                        {saved && <span className="settings-saved">Saved</span>}
                        <ThemeToggle className="shell__theme-toggle" />
                        <button className="settings-close app-close-button" type="button" onClick={requestClose} aria-label="Close settings">
                            {CLOSE_ICON}
                        </button>
                    </div>
                </header>

                <section className="settings-body">
                    <aside className="settings-rail" aria-label="Settings sections">
                        <div className="settings-rail__profile">
                            <div className="settings-profile__avatar settings-profile__avatar--rail">
                                {settings.avatarUrl ? (
                                    <img src={settings.avatarUrl} alt="" />
                                ) : (
                                    initials
                                )}
                            </div>
                            <div>
                                <strong>{settings.displayName || 'SkysyncR account'}</strong>
                                <span>{currentUser?.email ?? 'Unavailable'}</span>
                            </div>
                        </div>
                        <nav className="settings-rail__nav">
                            {settingsNavItems.map((item) => (
                                <a href={item.href} key={item.href}>
                                    <span className="settings-rail__icon">{item.icon}</span>
                                    <span>{item.label}</span>
                                </a>
                            ))}
                        </nav>
                    </aside>

                    <section className="settings-content">
                        <div className="settings-grid">
                        <section className="settings-panel settings-panel--hero" id="settings-profile">
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

                        <section className="settings-panel" id="settings-password">
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
                                <input
                                    type="text"
                                    name="username"
                                    autoComplete="username"
                                    value={currentUser?.email ?? ''}
                                    readOnly
                                    hidden
                                />
                                <label className="settings-field">
                                    <span>Current password</span>
                                    <div className="settings-password-input-group">
                                        <input
                                            type={showCurrentPassword ? 'text' : 'password'}
                                            autoComplete="current-password"
                                            value={currentPassword}
                                            onChange={(e) => {
                                                setCurrentPassword(e.target.value)
                                                setPasswordError(null)
                                                setPasswordSaved(false)
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="settings-password-toggle"
                                            onClick={() => setShowCurrentPassword((value) => !value)}
                                            aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                                        >
                                            <EyeIcon open={showCurrentPassword} />
                                        </button>
                                    </div>
                                </label>
                                <label className="settings-field">
                                    <span>New password</span>
                                    <div className="settings-password-input-group">
                                        <input
                                            type={showNewPassword ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            value={newPassword}
                                            onChange={(e) => {
                                                setNewPassword(e.target.value)
                                                setPasswordError(null)
                                                setPasswordSaved(false)
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="settings-password-toggle"
                                            onClick={() => setShowNewPassword((value) => !value)}
                                            aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                                        >
                                            <EyeIcon open={showNewPassword} />
                                        </button>
                                    </div>
                                </label>
                                {newPassword.length > 0 && <PasswordRequirements password={newPassword} />}
                                <label className="settings-field">
                                    <span>Confirm new password</span>
                                    <div className="settings-password-input-group">
                                        <input
                                            type={showConfirmNewPassword ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            value={confirmNewPassword}
                                            onChange={(e) => {
                                                setConfirmNewPassword(e.target.value)
                                                setPasswordError(null)
                                                setPasswordSaved(false)
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="settings-password-toggle"
                                            onClick={() => setShowConfirmNewPassword((value) => !value)}
                                            aria-label={showConfirmNewPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                                        >
                                            <EyeIcon open={showConfirmNewPassword} />
                                        </button>
                                    </div>
                                </label>
                                {passwordError && <p className="settings-error">{passwordError}</p>}
                                {passwordSaved && (
                                    <p className="settings-success" role="status" aria-live="polite">
                                        Password changed successfully.
                                    </p>
                                )}
                                <button
                                    className="btn btn--outline"
                                    type="submit"
                                    disabled={passwordSaving}
                                >
                                    {passwordSaving ? 'Changing...' : 'Change password'}
                                </button>
                            </form>
                        </section>

                        <section className="settings-panel settings-panel--compact" id="settings-vault">
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

                        <section className="settings-panel settings-panel--compact">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Layout</p>
                                    <h2>File density</h2>
                                </div>
                            </div>
                            <div className={`settings-segment settings-segment--layout settings-segment--${settings.layoutMode}`} role="group" aria-label="File layout">
                                <button
                                    className={settings.layoutMode === 'grid' ? 'is-active' : ''}
                                    type="button"
                                    onClick={() => updateSetting('layoutMode', 'grid')}
                                >
                                    {GRID_VIEW_ICON}
                                    <span>Grid</span>
                                </button>
                                <button
                                    className={settings.layoutMode === 'list' ? 'is-active' : ''}
                                    type="button"
                                    onClick={() => updateSetting('layoutMode', 'list')}
                                >
                                    {LIST_VIEW_ICON}
                                    <span>List</span>
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

                        <section className="settings-panel settings-panel--compact">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Appearance</p>
                                    <h2>Theme</h2>
                                </div>
                                <span className="settings-badge">{theme}</span>
                            </div>
                            <div className={`settings-segment settings-segment--theme settings-segment--theme-${themePreference}`} role="group" aria-label="Theme preference">
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

                        <section className="settings-panel settings-panel--wide settings-panel--data-export">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Privacy</p>
                                    <h2>User data export</h2>
                                </div>
                                <div className="settings-panel__actions">
                                    <button
                                        className="btn btn--outline settings-log-download"
                                        type="button"
                                        disabled={dataExportLoading}
                                        onClick={() => void downloadDataExport()}
                                    >
                                        {DOWNLOAD_ICON}
                                        <span>{dataExportLoading ? 'Preparing...' : 'Download export'}</span>
                                    </button>
                                </div>
                            </div>
                            <p className="settings-muted">
                                Includes encrypted files, metadata, share recipients, and recovery instructions.
                            </p>
                            {dataExportError && <p className="settings-error">{dataExportError}</p>}
                        </section>

                        <section className="settings-panel settings-panel--wide" id="settings-security">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Security</p>
                                    <h2>Privacy controls</h2>
                                </div>
                                <div className="settings-panel__actions">
                                    <button className="btn btn--outline" type="button" onClick={() => void lockVaultNow()}>
                                        Zablokuj teraz
                                    </button>
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
                                        onWheel={(e) => e.stopPropagation()}
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
                            <div className="settings-session-history" style={{ marginTop: '1.25rem' }}>
                                <h3>Authenticator app</h3>
                                {totpStatus?.enabled ? (
                                    <>
                                        <p className="settings-muted">Two-factor authentication is enabled. A verification code is required when signing in.</p>
                                        <label className="settings-field">
                                            <span>Current 6-digit code</span>
                                            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} placeholder="123456" />
                                        </label>
                                        <button className="btn btn--outline" type="button" disabled={totpSaving} onClick={() => void removeTotp()}>
                                            {totpSaving ? 'Disabling...' : 'Disable two-factor authentication'}
                                        </button>
                                    </>
                                ) : totpSetup ? (
                                    <>
                                        <p className="settings-muted">Scan this code in Google Authenticator, Microsoft Authenticator, 1Password or a compatible app, then enter its code to finish.</p>
                                        {totpQr && <svg width="196" height="196" viewBox={totpQr.viewBox} role="img" aria-label="Two-factor authentication QR code"><rect width="100%" height="100%" fill="white" /><path d={totpQr.path} fill="black" /></svg>}
                                        {totpQrUnavailable && <p className="settings-error">QR code could not be generated. Use the manual key below.</p>}
                                        <label className="settings-field">
                                            <span>Manual key</span>
                                            <input readOnly value={totpSetup.secret} onFocus={(event) => event.currentTarget.select()} />
                                        </label>
                                        <label className="settings-field">
                                            <span>6-digit code</span>
                                            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} placeholder="123456" />
                                        </label>
                                        <button className="btn btn--solid" type="button" disabled={totpSaving} onClick={() => void saveTotp()}>{totpSaving ? 'Enabling...' : 'Enable two-factor authentication'}</button>
                                    </>
                                ) : (
                                    <>
                                        <p className="settings-muted">Protect your account with a 6-digit code from an authenticator app.</p>
                                        <button className="btn btn--outline" type="button" disabled={totpSaving} onClick={() => void beginTotpSetup()}>{totpSaving ? 'Preparing...' : 'Set up two-factor authentication'}</button>
                                    </>
                                )}
                                {totpError && <p className="settings-error">{totpError}</p>}
                            </div>
                        </section>

                        <section className="settings-panel settings-panel--danger" id="settings-sessions">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Session</p>
                                    <h2>Devices and sessions</h2>
                                </div>
                            </div>
                            <label className="settings-field">
                                <span>This device name</span>
                                <input
                                    type="text"
                                    maxLength={80}
                                    value={currentDeviceLabel}
                                    onChange={(e) => setCurrentDeviceLabel(e.target.value)}
                                    onBlur={saveCurrentDeviceLabel}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.currentTarget.blur()
                                        }
                                    }}
                                    placeholder="Laptop służbowy"
                                />
                            </label>
                            <div className="settings-session-list">
                                {sessionsLoading && <p className="settings-muted">Loading signed-in devices...</p>}
                                {!sessionsLoading && sessionsData?.sessions.length === 0 && (
                                    <p className="settings-muted">No active sessions were found.</p>
                                )}
                                {sessionsData?.sessions.map((session) => (
                                    <div className="settings-session-item" key={session.id}>
                                        <span>
                                            <strong>{session.device_label}</strong>
                                            <small>
                                                Last active {formatSessionTime(session.last_used_at)}
                                            </small>
                                            <small>{describeApproximateLocation(session.ip_address)}</small>
                                            <small>Session expires {formatSessionTime(session.expires_at)}</small>
                                        </span>
                                        <span className="settings-session-controls">
                                            {session.current && <span className="settings-badge">Current</span>}
                                            {session.trusted && <span className="settings-badge settings-badge--trusted">Trusted</span>}
                                            <button
                                                className="btn btn--outline settings-session-button"
                                                type="button"
                                                disabled={trustingSessionId === session.id}
                                                onClick={() => void toggleTrustedSession(session.id, !session.trusted)}
                                            >
                                                {trustingSessionId === session.id ? 'Saving...' : session.trusted ? 'Untrust' : 'Trust'}
                                            </button>
                                            <button
                                                className="btn btn--outline settings-session-button"
                                                type="button"
                                                disabled={revokingSessionId === session.id}
                                                onClick={() => void signOutSession(session.id, session.current)}
                                            >
                                                {revokingSessionId === session.id ? 'Signing out...' : 'Sign out'}
                                            </button>
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="settings-session-history">
                                <h3>Activity history</h3>
                                {sessionsData?.activity.length === 0 && (
                                    <p className="settings-muted">No session activity has been recorded yet.</p>
                                )}
                                {sessionsData?.activity.slice(0, 8).map((event) => (
                                    <div className="settings-activity-item" key={event.id}>
                                        <span>
                                            <strong>{sessionActionLabels[event.action] ?? event.action}</strong>
                                            <small>
                                                {event.device_label ?? 'Unknown device'}
                                                {' - '}
                                                {describeApproximateLocation(event.ip_address)}
                                            </small>
                                        </span>
                                        <time dateTime={event.created_at}>{formatSessionTime(event.created_at)}</time>
                                    </div>
                                ))}
                            </div>
                            {confirmLogoutAll && (
                                <p className="settings-warning">
                                    Click again to sign out everywhere, including this browser.
                                </p>
                            )}
                            {logoutAllError && <p className="settings-error">{logoutAllError}</p>}
                            {sessionsError && <p className="settings-error">{sessionsError}</p>}
                            <div className="settings-session-actions">
                                <button className="btn btn--outline" type="button" onClick={signOut}>
                                    Sign out this device
                                </button>
                                <button
                                    className="btn btn--solid settings-danger-button"
                                    type="button"
                                    onClick={signOutEverywhere}
                                    disabled={logoutAllSaving}
                                >
                                    {logoutAllSaving
                                        ? 'Signing out...'
                                        : confirmLogoutAll
                                            ? 'Confirm sign out everywhere'
                                            : 'Sign out everywhere'}
                                </button>
                            </div>
                        </section>

                        <section className="settings-panel settings-panel--wide settings-panel--operation-log" id="settings-audit">
                            <div className="settings-panel__head">
                                <div>
                                    <p className="settings-kicker">Encrypted audit</p>
                                    <h2>Operation log</h2>
                                </div>
                                <div className="settings-panel__actions">
                                    <button
                                        className="btn btn--outline settings-log-download"
                                        type="button"
                                        onClick={downloadOperationLog}
                                        disabled={operationLogLoading || !operationLog?.operations.length}
                                    >
                                        {DOWNLOAD_ICON}
                                        <span>Download log</span>
                                    </button>
                                    <span className="settings-badge">Encrypted</span>
                                </div>
                            </div>
                            <div className="settings-session-history settings-operation-log">
                                {operationLogLoading && <p className="settings-muted">Loading operation log...</p>}
                                {!operationLogLoading && operationLog?.operations.length === 0 && (
                                    <p className="settings-muted">No user operations have been recorded yet.</p>
                                )}
                                {operationLog?.operations.map((event) => (
                                    <div className="settings-activity-item settings-operation-item" key={event.id}>
                                        <span>
                                            <strong>{operationLabels[event.operation] ?? event.operation}</strong>
                                            <small>ID {event.id}</small>
                                            <small>
                                                {event.device_label ?? 'Unknown device'}
                                                {event.resource_type ? ` · ${event.resource_type}` : ''}
                                                {event.resource_id ? ` · ${event.resource_id}` : ''}
                                            </small>
                                        </span>
                                        <time dateTime={event.created_at}>{formatSessionTime(event.created_at)}</time>
                                    </div>
                                ))}
                                {operationLogError && <p className="settings-error">{operationLogError}</p>}
                            </div>
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
            </section>
        </div>
    )
}

function SettingsModal(props: SettingsModalProps) {
    return <SettingsModalContent key={props.currentUser?.id ?? 'anonymous'} {...props} />
}

export default SettingsModal
