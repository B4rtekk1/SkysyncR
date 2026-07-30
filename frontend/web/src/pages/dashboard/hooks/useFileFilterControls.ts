import { useEffect, useMemo, useState } from 'react'
import {
    formatSizeValue,
    getFilterSummary,
    hasActiveFileFilters,
    matchesFileFilters,
    parseSizeInputToMb,
    parseSizeMb,
    sortFiles,
} from '../fileFilters'
import { loadFileFilter, loadFileSort, saveFileFilter, saveFileSort } from '../storage'
import type { ApiFolder } from '../../../api/files'
import type { FileTag, Tag } from '../../../api/tags'
import type { CurrentUserResponse } from '../../../api/users'
import type { FileFolderFilterOption, FileOwnerFilterOption, FileTypeFilterKey, FileVisibilityFilterKey, Item } from '../types'

function isSharedFile(item: Item): item is Item & { shared_by_user_id: string; shared_by_user_name: string | null } {
    return 'shared_by_user_id' in item
}

export function useFileFilterControls(
    items: Item[],
    tags: Tag[] = [],
    fileTagsByFileId: Map<string, FileTag[]> = new Map(),
    folders: ApiFolder[] = [],
    currentUser: CurrentUserResponse | null = null,
) {
    const [sortKey, setSortKey] = useState(() => loadFileSort())
    const [fileFilters, setFileFilters] = useState(() => loadFileFilter())
    const ownerOptions = useMemo<FileOwnerFilterOption[]>(() => {
        const ownerMap = new Map<string, string>()
        if (currentUser) ownerMap.set('__me__', currentUser.display_name || currentUser.email || 'Me')
        for (const item of items) {
            if (isSharedFile(item)) {
                ownerMap.set(item.shared_by_user_id, item.shared_by_user_name || 'Shared owner')
            } else if (!ownerMap.has('__me__')) {
                ownerMap.set('__me__', 'Me')
            }
        }
        return Array.from(ownerMap.entries()).map(([id, label]) => ({ id, label }))
    }, [currentUser, items])
    const folderOptions = useMemo<FileFolderFilterOption[]>(() => {
        const folderMap = new Map<string, string>()
        if (items.some((item) => item.folder_id === null)) folderMap.set('__root__', 'Root folder')
        for (const folder of folders) {
            folderMap.set(folder.id, folder.name)
        }
        for (const item of items) {
            if (item.folder_id && !folderMap.has(item.folder_id)) {
                folderMap.set(item.folder_id, `Folder ${item.folder_id.slice(0, 8)}`)
            }
        }
        return Array.from(folderMap.entries()).map(([id, label]) => ({ id, label }))
    }, [folders, items])
    const hasActiveFilter = hasActiveFileFilters(fileFilters)
    const filterSummary = getFilterSummary(fileFilters, tags, ownerOptions, folderOptions)
    const filteredItems = useMemo(
        () => items.filter((item) => matchesFileFilters(item, fileFilters, fileTagsByFileId.get(item.id) ?? [])),
        [fileFilters, fileTagsByFileId, items],
    )
    const sortedItems = useMemo(() => sortFiles(filteredItems, sortKey), [filteredItems, sortKey])
    const sizeSliderMax = useMemo(() => {
        const largestItemKb = Math.ceil(Math.max(0, ...items.map((item) => item.size_bytes)) / 1024)
        const configuredMaxKb = (parseSizeMb(fileFilters.maxSizeMb) ?? 0) * 1024
        return Math.max(1, largestItemKb, Math.ceil(configuredMaxKb))
    }, [fileFilters.maxSizeMb, items])
    const sizeSliderMinValue = Math.min((parseSizeMb(fileFilters.minSizeMb) ?? 0) * 1024, sizeSliderMax)
    const sizeSliderMaxValue = Math.min(
        (parseSizeMb(fileFilters.maxSizeMb) ?? sizeSliderMax / 1024) * 1024,
        sizeSliderMax,
    )
    const sizeSliderMinPct = (sizeSliderMinValue / sizeSliderMax) * 100
    const sizeSliderMaxPct = (sizeSliderMaxValue / sizeSliderMax) * 100

    useEffect(() => {
        saveFileSort(sortKey)
    }, [sortKey])

    useEffect(() => {
        saveFileFilter(fileFilters)
    }, [fileFilters])

    function clearFileTypes() {
        setFileFilters((current) => ({ ...current, types: [] }))
    }

    function toggleFileTypeFilter(type: FileTypeFilterKey) {
        setFileFilters((current) => ({
            ...current,
            types: current.types.includes(type)
                ? current.types.filter((currentType) => currentType !== type)
                : [...current.types, type],
        }))
    }

    function updateVisibilityFilter(visibility: FileVisibilityFilterKey) {
        setFileFilters((current) => ({ ...current, visibility }))
    }

    function updateOwnerFilter(ownerId: string) {
        setFileFilters((current) => ({ ...current, ownerId }))
    }

    function updateFolderFilter(folderId: string) {
        setFileFilters((current) => ({ ...current, folderId }))
    }

    function updateTagFilter(tagId: string) {
        setFileFilters((current) => ({ ...current, tagId }))
    }

    function updateSizeFilter(field: 'minSizeMb' | 'maxSizeMb', value: string) {
        const nextSizeMb = parseSizeInputToMb(value)
        if (nextSizeMb === null) return
        setFileFilters((current) => ({ ...current, [field]: nextSizeMb }))
    }

    function updateSizeSlider(field: 'minSizeMb' | 'maxSizeMb', value: string) {
        const nextValueKb = Math.round(Number(value))
        if (!Number.isFinite(nextValueKb)) return

        setFileFilters((current) => {
            const currentMinKb = (parseSizeMb(current.minSizeMb) ?? 0) * 1024
            const currentMaxKb = (parseSizeMb(current.maxSizeMb) ?? sizeSliderMax / 1024) * 1024

            if (field === 'minSizeMb') {
                const nextMinKb = Math.min(nextValueKb, currentMaxKb)
                return { ...current, minSizeMb: nextMinKb > 0 ? formatSizeValue(nextMinKb / 1024) : '' }
            }

            const nextMaxKb = Math.max(nextValueKb, currentMinKb)
            return { ...current, maxSizeMb: nextMaxKb < sizeSliderMax ? formatSizeValue(nextMaxKb / 1024) : '' }
        })
    }

    function updateExcludedExtensions(value: string) {
        setFileFilters((current) => ({ ...current, excludedExtensions: value }))
    }

    function updateModifiedDateFilter(field: 'modifiedFrom' | 'modifiedTo', value: string) {
        setFileFilters((current) => ({ ...current, [field]: value }))
    }

    function updateNoteQuery(value: string) {
        setFileFilters((current) => ({ ...current, noteQuery: value }))
    }

    function clearFileFilters() {
        setFileFilters({
            types: [],
            visibility: 'any',
            ownerId: '',
            folderId: '',
            tagId: '',
            minSizeMb: '',
            maxSizeMb: '',
            excludedExtensions: '',
            modifiedFrom: '',
            modifiedTo: '',
            noteQuery: '',
        })
    }

    return {
        sortKey,
        setSortKey,
        fileFilters,
        ownerOptions,
        folderOptions,
        hasActiveFilter,
        filterSummary,
        sortedItems,
        sizeSliderMax,
        sizeSliderMinValue,
        sizeSliderMaxValue,
        sizeSliderMinPct,
        sizeSliderMaxPct,
        clearFileTypes,
        toggleFileTypeFilter,
        updateVisibilityFilter,
        updateOwnerFilter,
        updateFolderFilter,
        updateTagFilter,
        updateSizeFilter,
        updateSizeSlider,
        updateExcludedExtensions,
        updateModifiedDateFilter,
        updateNoteQuery,
        clearFileFilters,
    }
}
