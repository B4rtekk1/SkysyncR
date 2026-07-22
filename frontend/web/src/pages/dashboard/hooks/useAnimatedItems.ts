import { useEffect, useMemo, useRef, useState } from 'react'
import { SEARCH_FILTER_EXIT_MS } from '../storage'
import type { Item, ViewKey } from '../types'

export function useAnimatedItems({
    items,
    view,
    favouriteIds,
    normalizedQuery,
    searchTextByItemId = new Map(),
}: {
    items: Item[]
    view: ViewKey
    favouriteIds: Set<string>
    normalizedQuery: string
    searchTextByItemId?: Map<string, string>
}) {
    const previousSearchQueryRef = useRef(normalizedQuery)
    const [animatedFiles, setAnimatedFiles] = useState<{ ids: string[]; exitingIds: Set<string> }>({
        ids: [],
        exitingIds: new Set(),
    })

    const visibleItems = useMemo(
        () =>
            items
                .filter((i) => `${i.filename} ${searchTextByItemId.get(i.id) ?? ''}`.toLowerCase().includes(normalizedQuery))
                .filter((i) => (view === 'favourites' ? favouriteIds.has(i.id) : true)),
        [favouriteIds, items, normalizedQuery, searchTextByItemId, view],
    )
    const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

    useEffect(() => {
        const nextIds = visibleItems.map((item) => item.id)
        const queryChanged = previousSearchQueryRef.current !== normalizedQuery
        previousSearchQueryRef.current = normalizedQuery

        if (!queryChanged) {
            setAnimatedFiles({ ids: nextIds, exitingIds: new Set() })
            return
        }

        let timeout: ReturnType<typeof setTimeout> | undefined
        setAnimatedFiles((prev) => {
            const nextIdSet = new Set(nextIds)
            const currentItemIds = new Set(items.map((item) => item.id))
            const exitingIds = prev.ids.filter((id) => !nextIdSet.has(id) && currentItemIds.has(id))

            if (exitingIds.length === 0) {
                return { ids: nextIds, exitingIds: new Set() }
            }

            timeout = setTimeout(() => {
                setAnimatedFiles({ ids: nextIds, exitingIds: new Set() })
            }, SEARCH_FILTER_EXIT_MS)

            return {
                ids: [
                    ...prev.ids.filter((id) => nextIdSet.has(id) || exitingIds.includes(id)),
                    ...nextIds.filter((id) => !prev.ids.includes(id)),
                ],
                exitingIds: new Set(exitingIds),
            }
        })

        return () => {
            if (timeout) clearTimeout(timeout)
        }
    }, [items, normalizedQuery, visibleItems])

    const renderedItems = animatedFiles.ids
        .map((id) => itemById.get(id))
        .filter((item): item is Item => Boolean(item))

    return {
        visibleItems,
        renderedItems,
        animatedFiles,
    }
}
