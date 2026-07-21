import { useEffect, useState } from 'react'
import {
    acceptGroupInvite as acceptRemoteGroupInvite,
    createGroup as createRemoteGroup,
    createGroupInvite,
    declineGroupInvite as declineRemoteGroupInvite,
    deleteGroupMember,
    deleteGroup as deleteRemoteGroup,
    deleteGroupInvite,
    leaveGroup as leaveRemoteGroup,
    listIncomingGroupInvites,
    listGroups,
    updateGroupMemberRole,
    updateGroup as updateRemoteGroup,
} from '../../../api/groups'
import { loadGroups, saveGroups } from '../storage'
import type { Group, GroupIncomingInvite, GroupInviteRole } from '../types'

export function useDashboardGroups() {
    const [groups, setGroups] = useState<Group[]>([])
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
    const [groupCreateOpen, setGroupCreateOpen] = useState(false)
    const [groupInviteOpen, setGroupInviteOpen] = useState(false)
    const [groupError, setGroupError] = useState<string | null>(null)
    const [incomingInvites, setIncomingInvites] = useState<GroupIncomingInvite[]>([])

    useEffect(() => {
        let active = true

        async function loadRemoteGroups() {
            try {
                setGroupError(null)
                const [remoteGroups, remoteInvites] = await Promise.all([
                    listGroups(),
                    listIncomingGroupInvites(),
                ])
                if (!active) return

                setIncomingInvites(remoteInvites)
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
                if (active) {
                    setGroups(migratedGroups)
                    setIncomingInvites(remoteInvites)
                }
            } catch (error) {
                if (active) {
                    setGroupError(error instanceof Error ? error.message : 'Could not load groups.')
                    setGroups([])
                    setIncomingInvites([])
                }
            }
        }

        void loadRemoteGroups()

        return () => {
            active = false
        }
    }, [])

    async function refreshGroups() {
        const [remoteGroups, remoteInvites] = await Promise.all([
            listGroups(),
            listIncomingGroupInvites(),
        ])
        setGroups(remoteGroups)
        setIncomingInvites(remoteInvites)
        return remoteGroups
    }

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

    async function acceptGroupInvite(inviteId: string) {
        try {
            setGroupError(null)
            const acceptedInvite = incomingInvites.find((invite) => invite.id === inviteId)
            await acceptRemoteGroupInvite(inviteId)
            await refreshGroups()
            if (!activeGroupId && acceptedInvite) setActiveGroupId(acceptedInvite.groupId)
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not accept group invite.')
        }
    }

    async function declineGroupInvite(inviteId: string) {
        try {
            setGroupError(null)
            await declineRemoteGroupInvite(inviteId)
            await refreshGroups()
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not decline group invite.')
        }
    }

    async function updateMemberRole(groupId: string, memberUserId: string, role: GroupInviteRole) {
        try {
            setGroupError(null)
            await updateGroupMemberRole(groupId, memberUserId, role)
            await refreshGroups()
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not update group member.')
        }
    }

    async function removeGroupMember(groupId: string, memberUserId: string) {
        try {
            setGroupError(null)
            await deleteGroupMember(groupId, memberUserId)
            await refreshGroups()
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not remove group member.')
        }
    }

    async function leaveGroup(groupId: string) {
        try {
            setGroupError(null)
            await leaveRemoteGroup(groupId)
            setGroups((prev) => prev.filter((group) => group.id !== groupId))
            setActiveGroupId(null)
            setGroupCreateOpen(false)
            setGroupInviteOpen(false)
            await refreshGroups()
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'Could not leave group.')
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
                              members: group.members,
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
        incomingInvites,
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
        acceptGroupInvite,
        declineGroupInvite,
        updateMemberRole,
        removeGroupMember,
        leaveGroup,
        updateGroup,
        deleteGroup,
        removeGroupInvite,
    }
}
