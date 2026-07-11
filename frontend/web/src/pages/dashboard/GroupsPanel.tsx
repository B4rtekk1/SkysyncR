import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { Group, GroupInviteRole } from './types'
import { formatRelative } from './fileUtils'
export function GroupsPanel({
                                groups,
                                activeGroupId,
                                createOpen,
                                inviteOpen,
                                onCreateGroup,
                                onOpenCreate,
                                onCloseCreate,
                                onOpenGroup,
                                onBackToGroups,
                                onOpenInvite,
                                onCloseInvite,
                                onInvite,
                                onRemoveInvite,
                                onUpdateGroup,
                                onDeleteGroup,
                            }: {
    groups: Group[]
    activeGroupId: string | null
    createOpen: boolean
    inviteOpen: boolean
    onCreateGroup: (name: string, defaultRole: GroupInviteRole) => void
    onOpenCreate: () => void
    onCloseCreate: () => void
    onOpenGroup: (id: string) => void
    onBackToGroups: () => void
    onOpenInvite: () => void
    onCloseInvite: () => void
    onInvite: (groupId: string, email: string, role: GroupInviteRole) => void
    onRemoveInvite: (groupId: string, inviteId: string) => void
    onUpdateGroup: (groupId: string, name: string, defaultRole: GroupInviteRole) => void
    onDeleteGroup: (groupId: string) => void
}) {
    const [email, setEmail] = useState('')
    const [role, setRole] = useState<GroupInviteRole>('viewer')
    const [groupName, setGroupName] = useState('')
    const [defaultRole, setDefaultRole] = useState<GroupInviteRole>('viewer')
    const [settingsName, setSettingsName] = useState('')
    const [settingsRole, setSettingsRole] = useState<GroupInviteRole>('viewer')
    const [formError, setFormError] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)
    const [settingsError, setSettingsError] = useState<string | null>(null)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const activeGroup = activeGroupId ? groups.find((group) => group.id === activeGroupId) ?? null : null

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        if (activeGroup && inviteOpen) {
            timeout = setTimeout(() => setRole(activeGroup.defaultRole), 0)
        }

        return () => {
            if (timeout) clearTimeout(timeout)
        }
    }, [activeGroup, inviteOpen])

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        if (activeGroup) {
            timeout = setTimeout(() => {
                setSettingsName(activeGroup.name)
                setSettingsRole(activeGroup.defaultRole)
                setSettingsError(null)
                setDeleteConfirmOpen(false)
            }, 0)
        }

        return () => {
            if (timeout) clearTimeout(timeout)
        }
    }, [activeGroup])

    useEffect(() => {
        if (!createOpen && !inviteOpen) return

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key !== 'Escape') return

            if (inviteOpen) {
                setEmail('')
                setRole('viewer')
                setFormError(null)
                onCloseInvite()
            }

            if (createOpen) {
                setGroupName('')
                setDefaultRole('viewer')
                setCreateError(null)
                onCloseCreate()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [createOpen, inviteOpen, onCloseCreate, onCloseInvite])

    function submitSettings(e: React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!activeGroup) return

        const normalizedName = settingsName.trim()

        if (normalizedName.length < 2) {
            setSettingsError('Enter a group name.')
            return
        }

        if (
            groups.some(
                (group) => group.id !== activeGroup.id && group.name.toLowerCase() === normalizedName.toLowerCase(),
            )
        ) {
            setSettingsError('A group with this name already exists.')
            return
        }

        onUpdateGroup(activeGroup.id, normalizedName, settingsRole)
        setSettingsError(null)
    }

    function submitGroup(e: React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault()
        const normalizedName = groupName.trim()

        if (normalizedName.length < 2) {
            setCreateError('Enter a group name.')
            return
        }

        if (groups.some((group) => group.name.toLowerCase() === normalizedName.toLowerCase())) {
            setCreateError('A group with this name already exists.')
            return
        }

        onCreateGroup(normalizedName, defaultRole)
        setGroupName('')
        setDefaultRole('viewer')
        setCreateError(null)
        onCloseCreate()
    }

    function closeCreate() {
        setGroupName('')
        setDefaultRole('viewer')
        setCreateError(null)
        onCloseCreate()
    }

    function submitInvite(e: React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!activeGroup) return

        const normalizedEmail = email.trim().toLowerCase()

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            setFormError('Enter a valid email address.')
            return
        }

        if (activeGroup.invites.some((invite) => invite.email === normalizedEmail)) {
            setFormError('This person is already invited.')
            return
        }

        onInvite(activeGroup.id, normalizedEmail, role)
        setEmail('')
        setRole('viewer')
        setFormError(null)
        onCloseInvite()
    }

    function closeInvite() {
        setEmail('')
        setRole('viewer')
        setFormError(null)
        onCloseInvite()
    }

    if (activeGroup) {
        return (
            <>
                <section className="groups-panel" aria-label={`${activeGroup.name} group`}>
                    <div className="groups-panel__head groups-panel__head--detail">
                        <div className="groups-hero">
                            <button className="groups-panel__back" type="button" onClick={onBackToGroups}>
                                <span aria-hidden="true">←</span> All groups
                            </button>
                            <div className="groups-hero__identity">
                                <div className="groups-hero__mark" aria-hidden="true">{activeGroup.name.charAt(0).toUpperCase()}</div>
                                <div>
                                    <p className="groups-panel__eyebrow">Shared workspace</p>
                                    <h2 className="groups-panel__title">{activeGroup.name}</h2>
                                </div>
                            </div>
                        </div>
                        <button className="btn btn--solid" type="button" onClick={onOpenInvite}>
                            <span aria-hidden="true">+</span> Add member
                        </button>
                    </div>

                    <div className="groups-summary">
                        <div className="groups-summary__item">
                            <span className="groups-summary__icon" aria-hidden="true">+</span>
                            <div>
                                <strong>{activeGroup.invites.length}</strong>
                                <span>Pending invitations</span>
                            </div>
                        </div>
                        <div className="groups-summary__item">
                            <span className="groups-summary__icon" aria-hidden="true">•</span>
                            <div>
                                <strong>{formatRelative(activeGroup.createdAt)}</strong>
                                <span>Created</span>
                            </div>
                        </div>
                        <div className="groups-summary__item">
                            <span className="groups-summary__icon" aria-hidden="true">✓</span>
                            <div>
                                <strong className={`groups-role groups-role--${activeGroup.defaultRole}`}>{activeGroup.defaultRole}</strong>
                                <span>Default access</span>
                            </div>
                        </div>
                    </div>

                    <form className="groups-settings" onSubmit={submitSettings}>
                        <div className="groups-settings__head">
                            <div>
                                <p className="groups-panel__eyebrow">Settings</p>
                                <h3 className="groups-settings__title">Group settings</h3>
                            </div>
                            <button className="btn btn--outline" type="submit">
                                Save changes
                            </button>
                        </div>

                        <div className="groups-settings__grid">
                            <label className="groups-invite__field">
                                <span>Group name</span>
                                <input
                                    type="text"
                                    value={settingsName}
                                    onChange={(e) => setSettingsName(e.target.value)}
                                />
                            </label>
                            <label className="groups-invite__field">
                                <span>Default user role</span>
                                <select
                                    value={settingsRole}
                                    onChange={(e) => setSettingsRole(e.target.value as GroupInviteRole)}
                                >
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </label>
                        </div>

                        {settingsError && (
                            <p className="groups-invite__error" role="alert">
                                {settingsError}
                            </p>
                        )}

                        <div className="groups-danger">
                            <div>
                                <strong>Delete group</strong>
                                <span>Removes the group and all pending invitations from this device.</span>
                            </div>
                            {deleteConfirmOpen ? (
                                <div className="groups-danger__actions">
                                    <button
                                        className="btn btn--ghost"
                                        type="button"
                                        onClick={() => setDeleteConfirmOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="groups-danger__delete"
                                        type="button"
                                        onClick={() => onDeleteGroup(activeGroup.id)}
                                    >
                                        Confirm delete
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="groups-danger__delete"
                                    type="button"
                                    onClick={() => setDeleteConfirmOpen(true)}
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </form>

                    <div className="groups-members">
                        <div className="groups-members__head">
                            <div>
                                <p className="groups-panel__eyebrow">Access</p>
                                <h3>Members</h3>
                            </div>
                            <span className="groups-members__count">{activeGroup.invites.length}</span>
                        </div>
                        <div className="groups-invites">
                            {activeGroup.invites.length > 0 ? (
                                activeGroup.invites.map((invite) => (
                                    <div className="groups-invites__row" key={invite.id}>
                                        <div className="groups-invites__avatar" aria-hidden="true">
                                            {invite.email.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="groups-invites__person">
                                            <strong>{invite.email}</strong>
                                            <span>Invited {formatRelative(invite.createdAt)}</span>
                                        </div>
                                        <span className={`groups-role groups-role--${invite.role}`}>{invite.role}</span>
                                        <button
                                            className="groups-invites__remove"
                                            type="button"
                                            onClick={() => onRemoveInvite(activeGroup.id, invite.id)}
                                            aria-label={`Cancel invitation for ${invite.email}`}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <p className="groups-invites__empty">No invitations yet. Add the first member to start collaborating.</p>
                            )}
                        </div>
                    </div>
                </section>

                {inviteOpen && (
                    <div className="groups-modal" role="presentation" onMouseDown={closeInvite}>
                        <form
                            className="groups-modal__dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-label={`Invite member to ${activeGroup.name}`}
                            aria-describedby="group-invite-description"
                            onSubmit={submitInvite}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="groups-modal__head">
                                <div>
                                    <p className="groups-panel__eyebrow">Add member</p>
                                    <h3 className="groups-modal__title">Invite to {activeGroup.name}</h3>
                                </div>
                                <button
                                    className="groups-modal__close"
                                    type="button"
                                    onClick={closeInvite}
                                    aria-label="Close add-member dialog"
                                >
                                    x
                                </button>
                            </div>

                            <p className="groups-modal__description" id="group-invite-description">
                                Choose an email address and access level for the new member.
                            </p>

                            <label className="groups-invite__field">
                                <span>Email</span>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="name@example.com"
                                    autoFocus
                                />
                            </label>
                            <label className="groups-invite__field">
                                <span>Role</span>
                                <select value={role} onChange={(e) => setRole(e.target.value as GroupInviteRole)}>
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </label>

                            {formError && (
                                <p className="groups-invite__error" role="alert">
                                    {formError}
                                </p>
                            )}

                            <div className="groups-modal__actions">
                                <button className="btn btn--outline" type="button" onClick={closeInvite}>
                                    Cancel
                                </button>
                                <button className="btn btn--solid" type="submit">
                                    Send invitation
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </>
        )
    }

    return (
        <>
            <section className="groups-panel groups-panel--listing-view" aria-label="Groups">
                <div className="groups-panel__head groups-panel__head--listing">
                    <div>
                        <h2 className="groups-panel__title">Your groups</h2>
                    </div>
                    <button className="btn btn--solid" type="button" onClick={onOpenCreate}>
                        <span aria-hidden="true">+</span> New group
                    </button>
                </div>

                {groups.length > 0 ? (
                    <div className="groups-list">
                        {groups.map((group) => (
                            <button
                                className="groups-list__item"
                                key={group.id}
                                type="button"
                                onClick={() => onOpenGroup(group.id)}
                            >
                                <div className="groups-list__mark" aria-hidden="true">{group.name.charAt(0).toUpperCase()}</div>
                                <div className="groups-list__body">
                                    <div className="groups-list__title-row"><strong>{group.name}</strong><span className={`groups-role groups-role--${group.defaultRole}`}>{group.defaultRole}</span></div>
                                    <div className="groups-list__meta">
                                        <span>{group.invites.length === 1 ? '1 pending invitation' : `${group.invites.length} pending invitations`}</span>
                                        <span>Created {formatRelative(group.createdAt)}</span>
                                    </div>
                                </div>
                                <span className="groups-list__chevron" aria-hidden="true">→</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="groups-empty">
                        <div className="groups-empty__icon" aria-hidden="true">+</div>
                        <p className="empty-pane__title">Create your first group</p>
                        <p className="empty-pane__body">Give your team a private shared space with access you control.</p>
                        <button className="btn btn--solid" type="button" onClick={onOpenCreate}>Create group</button>
                    </div>
                )}
            </section>

            {createOpen && (
                <div className="groups-modal" role="presentation" onMouseDown={closeCreate}>
                    <form
                        className="groups-modal__dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Create group"
                        aria-describedby="group-create-description"
                        onSubmit={submitGroup}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="groups-modal__head">
                            <div>
                                <p className="groups-panel__eyebrow">New group</p>
                                <h3 className="groups-modal__title">Create group</h3>
                            </div>
                            <button
                                className="groups-modal__close"
                                type="button"
                                onClick={closeCreate}
                                aria-label="Close group dialog"
                            >
                                x
                            </button>
                        </div>

                        <p className="groups-modal__description" id="group-create-description">
                            Set up a private shared space and choose its default access level.
                        </p>

                        <label className="groups-invite__field">
                            <span>Group name</span>
                            <input
                                type="text"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                placeholder="Design team"
                                autoFocus
                            />
                        </label>
                        <label className="groups-invite__field">
                            <span>Default user role</span>
                            <select
                                value={defaultRole}
                                onChange={(e) => setDefaultRole(e.target.value as GroupInviteRole)}
                            >
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                                <option value="admin">Admin</option>
                            </select>
                        </label>

                        {createError && (
                            <p className="groups-invite__error" role="alert">
                                {createError}
                            </p>
                        )}

                        <div className="groups-modal__actions">
                            <button className="btn btn--outline" type="button" onClick={closeCreate}>
                                Cancel
                            </button>
                            <button className="btn btn--solid" type="submit">
                                Create group
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
    )
}
