import { authenticatedFetch } from './auth'
import type { Group, GroupInvite, GroupInviteRole } from '../pages/dashboard/types'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

type ApiGroupInvite = {
    id: string
    email: string
    role: GroupInviteRole
    createdAt: string
}

type ApiGroup = {
    id: string
    name: string
    defaultRole: GroupInviteRole
    createdAt: string
    invites: ApiGroupInvite[]
}

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data = await response.json()
        return data.message || 'An error occurred'
    } catch {
        return 'An error occurred'
    }
}

function toGroupInvite(invite: ApiGroupInvite): GroupInvite {
    return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        createdAt: invite.createdAt,
    }
}

function toGroup(group: ApiGroup): Group {
    return {
        id: group.id,
        name: group.name,
        defaultRole: group.defaultRole,
        createdAt: group.createdAt,
        invites: group.invites.map(toGroupInvite),
    }
}

export async function listGroups(): Promise<Group[]> {
    const res = await authenticatedFetch(`${API_BASE}groups`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    const groups = (await res.json()) as ApiGroup[]
    return groups.map(toGroup)
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
    return toGroup((await res.json()) as ApiGroup)
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
    return toGroup((await res.json()) as ApiGroup)
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
    return toGroupInvite((await res.json()) as ApiGroupInvite)
}

export async function deleteGroupInvite(groupId: string, inviteId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}groups/${groupId}/invites/${inviteId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}
