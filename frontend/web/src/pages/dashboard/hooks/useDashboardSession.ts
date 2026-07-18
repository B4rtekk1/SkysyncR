import { useEffect, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { logout } from '../../../api/auth'
import { getUnlockedVaultSession } from '../../../api/session'
import type { CurrentUserResponse } from '../../../api/users'
import { onActivePrivateKeyCleared } from '../../../crypto/storage'
import { loadUserSettings, type SettingsState } from '../../settingsPreferences'

export function useDashboardSession(navigate: NavigateFunction) {
    const [currentUser, setCurrentUser] = useState<CurrentUserResponse | null>(null)
    const [displayName, setDisplayName] = useState('You')
    const [avatarUrl, setAvatarUrl] = useState('')
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null)

    useEffect(() => {
        return onActivePrivateKeyCleared((userId) => {
            setPrivateKey(null)
            if (!currentUser || userId === null || userId === currentUser.id) {
                navigate('/login', { replace: true })
            }
        })
    }, [currentUser, navigate])

    useEffect(() => {
        let active = true
        getUnlockedVaultSession()
            .then((session) => {
                if (!active) return
                if (!session) {
                    navigate('/login', { replace: true })
                    return
                }

                setCurrentUser(session.user)
                setPublicKey(session.user.public_key)
                setPrivateKey(session.privateKey)
                const localSettings = loadUserSettings(session.user)
                setDisplayName(localSettings.displayName || session.user.display_name || 'You')
                setAvatarUrl(localSettings.avatarUrl)
            })
            .catch(() => {
                if (active) {
                    setCurrentUser(null)
                    setPublicKey(null)
                    setPrivateKey(null)
                    navigate('/login', { replace: true })
                }
            })

        return () => {
            active = false
        }
    }, [navigate])

    async function signOut() {
        await logout()
        navigate('/login', { replace: true })
    }

    function handleSettingsSave(profile: SettingsState) {
        setDisplayName(profile.displayName || 'You')
        setAvatarUrl(profile.avatarUrl)
        setCurrentUser((current) =>
            current
                ? {
                      ...current,
                      display_name: profile.displayName || null,
                      avatar_url: profile.avatarUrl || null,
                      default_view: profile.defaultView,
                      layout_mode: profile.layoutMode,
                      upload_protection: profile.uploadProtection,
                      compact_metadata: profile.compactMetadata,
                      device_lock: profile.deviceLock,
                      sync_on_metered: profile.syncOnMetered,
                      trash_retention_days: profile.trashRetentionDays,
                  }
                : current,
        )
    }

    return {
        currentUser,
        displayName,
        avatarUrl,
        publicKey,
        privateKey,
        signOut,
        handleSettingsSave,
    }
}
