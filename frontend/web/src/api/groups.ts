import { authenticatedFetch } from './auth'
import type { Group, GroupInvite, GroupInviteRole } from '../pages/dashboard/types'
import type {
    Group as ApiGroup,
    GroupInvite as ApiGroupInvite,
    GroupShareRecipient,
} from './generated'
import {
    group,
    groupInvite,
    groups,
    groupShareRecipients,
    parseApiErrorBody,
    readJson,
} from './validators'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

export type { GroupShareRecipient }

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data: unknown = await response.json()
        return parseApiErrorBody(data) ?? 'An error occurred'
    } catch {
        return 'An error occurred'
    }
}

function toGroupInvite(invite: ApiGroupInvite): GroupInvite {
    return {
        id: invite.id,
        email: invite.email,
        role: invite.role as GroupInviteRole,
        createdAt: invite.createdAt,
    }
}

function toGroup(group: ApiGroup): Group {
    return {
        id: group.id,
        name: group.name,
        defaultRole: group.defaultRole as GroupInviteRole,
        createdAt: group.createdAt,
        invites: group.invites.map(toGroupInvite),
    }
}

export async function listGroups(): Promise<Group[]> {
    const res = await authenticatedFetch(`${API_BASE}groups`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    const apiGroups = await readJson(res, groups, 'Group[]')
    return apiGroups.map(toGroup)
}

export async function createGroup(name: string, defaultRole: GroupInviteRole): Promise<Group> {
    const res = await authenticatedFetch(`${API_BASE}groups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, default_role: defaultRole }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return toGroup(await readJson(res, group, 'Group'))
}

export async function updateGroup(
    groupId: string,
    name: string,
    defaultRole: GroupInviteRole,
): Promise<Group> {
    const res = await authenticatedFetch(`${API_BASE}groups/${groupId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, default_role: defaultRole }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return toGroup(await readJson(res, group, 'Group'))
}

export async function deleteGroup(groupId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}groups/${groupId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function createGroupInvite(
    groupId: string,
    email: string,
    role: GroupInviteRole,
): Promise<GroupInvite> {
    const res = await authenticatedFetch(`${API_BASE}groups/${groupId}/invites`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, role }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return toGroupInvite(await readJson(res, groupInvite, 'GroupInvite'))
}

export async function deleteGroupInvite(groupId: string, inviteId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}groups/${groupId}/invites/${inviteId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function listGroupShareRecipients(groupId: string): Promise<GroupShareRecipient[]> {
    const res = await authenticatedFetch(`${API_BASE}groups/${groupId}/recipients`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, groupShareRecipients, 'GroupShareRecipient[]')
}
