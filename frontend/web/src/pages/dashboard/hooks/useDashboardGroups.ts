import { useState } from 'react'
import { loadGroups, saveGroups } from '../storage'
import type { Group, GroupInviteRole } from '../types'

export function useDashboardGroups() {
    const [groups, setGroups] = useState<Group[]>(() => loadGroups())
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
    const [groupCreateOpen, setGroupCreateOpen] = useState(false)
    const [groupInviteOpen, setGroupInviteOpen] = useState(false)

    function createGroup(name: string, defaultRole: GroupInviteRole) {
        setGroups((prev) => {
            const group: Group = {
                id: crypto.randomUUID(),
                name,
                defaultRole,
                createdAt: new Date().toISOString(),
                invites: [],
            }
            const next = [group, ...prev]
            saveGroups(next)
            setActiveGroupId(group.id)
            return next
        })
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

    function addGroupInvite(groupId: string, email: string, role: GroupInviteRole) {
        setGroups((prev) => {
            const next = prev.map((group) =>
                group.id === groupId
                    ? {
                          ...group,
                          invites: [
                              {
                                  id: crypto.randomUUID(),
                                  email,
                                  role,
                                  createdAt: new Date().toISOString(),
                              },
                              ...group.invites,
                          ],
                      }
                    : group,
            )
            saveGroups(next)
            return next
        })
    }

    function updateGroup(groupId: string, name: string, defaultRole: GroupInviteRole) {
        setGroups((prev) => {
            const next = prev.map((group) =>
                group.id === groupId
                    ? {
                          ...group,
                          name,
                          defaultRole,
                      }
                    : group,
            )
            saveGroups(next)
            return next
        })
    }

    function deleteGroup(groupId: string) {
        setGroups((prev) => {
            const next = prev.filter((group) => group.id !== groupId)
            saveGroups(next)
            return next
        })
        setActiveGroupId(null)
        setGroupCreateOpen(false)
        setGroupInviteOpen(false)
    }

    function removeGroupInvite(groupId: string, inviteId: string) {
        setGroups((prev) => {
            const next = prev.map((group) =>
                group.id === groupId
                    ? {
                          ...group,
                          invites: group.invites.filter((invite) => invite.id !== inviteId),
                      }
                    : group,
            )
            saveGroups(next)
            return next
        })
    }

    return {
        groups,
        activeGroupId,
        groupCreateOpen,
        groupInviteOpen,
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
