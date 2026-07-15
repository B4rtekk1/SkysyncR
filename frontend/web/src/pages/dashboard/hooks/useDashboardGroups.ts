import { useEffect, useState } from 'react'
import {
    createGroup as createRemoteGroup,
    createGroupInvite,
    deleteGroup as deleteRemoteGroup,
    deleteGroupInvite,
    listGroups,
    updateGroup as updateRemoteGroup,
} from '../../../api/groups'
import { loadGroups, saveGroups } from '../storage'
import type { Group, GroupInviteRole } from '../types'

export function useDashboardGroups() {
    const [groups, setGroups] = useState<Group[]>([])
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
    const [groupCreateOpen, setGroupCreateOpen] = useState(false)
    const [groupInviteOpen, setGroupInviteOpen] = useState(false)
    const [groupError, setGroupError] = useState<string | null>(null)

    useEffect(() => {
        let active = true

        async function loadRemoteGroups() {
            try {
                setGroupError(null)
                const remoteGroups = await listGroups()
                if (!active) return

                if (remoteGroups.length > 0) {
                    setGroups(remoteGroups)
                    saveGroups([])
                    return
                }

                const localGroups = loadGroups()
                if (localGroups.length === 0) {
                    setGroups([])
                    return
                }

                const migratedGroups: Group[] = []
                for (const localGroup of localGroups) {
                    const created = await createRemoteGroup(localGroup.name, localGroup.defaultRole)
                    const invites = []
                    for (const invite of localGroup.invites) {
                        invites.push(await createGroupInvite(created.id, invite.email, invite.role))
                    }
                    migratedGroups.push({ ...created, invites })
                }

                saveGroups([])
                if (active) setGroups(migratedGroups)
            } catch (error) {
                if (active) {
                    setGroupError(error instanceof Error ? error.message : 'Could not load groups.')
                    setGroups([])
                }
            }
        }

        void loadRemoteGroups()

        return () => {
            active = false
        }
    }, [])

    async function createGroup(name: string, defaultRole: GroupInviteRole) {
        try {
            setGroupError(null)
            const group = await createRemoteGroup(name, defaultRole)
            setGroups((prev) => [group, ...prev])
            setActiveGroupId(group.id)
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not create group.')
        }
    }

    function openGroup(id: string) {
        setActiveGroupId(id)
        setGroupCreateOpen(false)
        setGroupInviteOpen(false)
    }

    function backToGroups() {
        setActiveGroupId(null)
        setGroupCreateOpen(false)
        setGroupInviteOpen(false)
    }

    async function addGroupInvite(groupId: string, email: string, role: GroupInviteRole) {
        try {
            setGroupError(null)
            const invite = await createGroupInvite(groupId, email, role)
            setGroups((prev) =>
                prev.map((group) =>
                    group.id === groupId
                        ? {
                              ...group,
                              invites: [invite, ...group.invites],
                          }
                        : group,
                ),
            )
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not create group invite.')
        }
    }

    async function updateGroup(groupId: string, name: string, defaultRole: GroupInviteRole) {
        try {
            setGroupError(null)
            const updated = await updateRemoteGroup(groupId, name, defaultRole)
            setGroups((prev) =>
                prev.map((group) =>
                    group.id === groupId
                        ? {
                              ...updated,
                              invites: group.invites,
                          }
                        : group,
                ),
            )
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not update group.')
        }
    }

    async function deleteGroup(groupId: string) {
        try {
            setGroupError(null)
            await deleteRemoteGroup(groupId)
            setGroups((prev) => prev.filter((group) => group.id !== groupId))
            setActiveGroupId(null)
            setGroupCreateOpen(false)
            setGroupInviteOpen(false)
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not delete group.')
        }
    }

    async function removeGroupInvite(groupId: string, inviteId: string) {
        try {
            setGroupError(null)
            await deleteGroupInvite(groupId, inviteId)
            setGroups((prev) =>
                prev.map((group) =>
                    group.id === groupId
                        ? {
                              ...group,
                              invites: group.invites.filter((invite) => invite.id !== inviteId),
                          }
                        : group,
                ),
            )
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not remove group invite.')
        }
    }

    return {
        groups,
        activeGroupId,
        groupCreateOpen,
        groupInviteOpen,
        groupError,
        setGroupCreateOpen,
        setGroupInviteOpen,
        createGroup,
        openGroup,
        backToGroups,
        addGroupInvite,
        updateGroup,
        deleteGroup,
        removeGroupInvite,
    }
}
