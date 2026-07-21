import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { FileFilterModal } from './FileFilterModal'
import { GRID_VIEW_ICON, LIST_VIEW_ICON } from '../icons'
import { FILE_SORT_LABELS } from '../fileFilters'
import type { FileFilters, FileSortKey, FileTypeFilterKey, FileVisibilityFilterKey, LayoutMode, ViewKey } from '../types'

type DashboardToolbarProps = {
    view: ViewKey
    sortMenuRef: RefObject<HTMLDivElement | null>
    filterMenuRef: RefObject<HTMLDivElement | null>
    sortMenuOpen: boolean
    sortMenuClosing: boolean
    filterMenuOpen: boolean
    filterMenuClosing: boolean
    sortKey: FileSortKey
    layoutMode: LayoutMode
    layoutSwitchTarget: LayoutMode | null
    filterSummary: string
    query: string
    fileFilters: FileFilters
    hasActiveFilter: boolean
    sizeSliderMax: number
    sizeSliderMinValue: number
    sizeSliderMaxValue: number
    sizeSliderMinPct: number
    sizeSliderMaxPct: number
    onToggleSortMenu: () => void
    onCloseSortMenu: () => void
    onSortKeyChange: (value: FileSortKey) => void
    onToggleFilterMenu: () => void
    onCloseFilterMenu: () => void
    onQueryChange: (value: string) => void
    onClearFileTypes: () => void
    onToggleFileType: (type: FileTypeFilterKey) => void
    onVisibilityChange: (visibility: FileVisibilityFilterKey) => void
    onSizeInputChange: (field: 'minSizeMb' | 'maxSizeMb', value: string) => void
    onSizeSliderChange: (field: 'minSizeMb' | 'maxSizeMb', value: string) => void
    onExcludedExtensionsChange: (value: string) => void
    onModifiedDateChange: (field: 'modifiedFrom' | 'modifiedTo', value: string) => void
    onClearFilters: () => void
    onLayoutModeChange: (mode: LayoutMode) => void
    onOpenFileCreate: () => void
    onOpenFolderCreate: () => void
    onUploadChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export function DashboardToolbar({
    view,
    sortMenuRef,
    filterMenuRef,
    sortMenuOpen,
    sortMenuClosing,
    filterMenuOpen,
    filterMenuClosing,
    sortKey,
    layoutMode,
    layoutSwitchTarget,
    filterSummary,
    query,
    fileFilters,
    hasActiveFilter,
    sizeSliderMax,
    sizeSliderMinValue,
    sizeSliderMaxValue,
    sizeSliderMinPct,
    sizeSliderMaxPct,
    onToggleSortMenu,
    onCloseSortMenu,
    onSortKeyChange,
    onToggleFilterMenu,
    onCloseFilterMenu,
    onQueryChange,
    onClearFileTypes,
    onToggleFileType,
    onVisibilityChange,
    onSizeInputChange,
    onSizeSliderChange,
    onExcludedExtensionsChange,
    onModifiedDateChange,
    onClearFilters,
    onLayoutModeChange,
    onOpenFileCreate,
    onOpenFolderCreate,
    onUploadChange,
}: DashboardToolbarProps) {
    const [addMenuOpen, setAddMenuOpen] = useState(false)
    const addMenuRef = useRef<HTMLDivElement>(null)
    const uploadInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!addMenuOpen) return

        function closeOnOutsideClick(e: MouseEvent) {
            if (addMenuRef.current?.contains(e.target as Node)) return
            setAddMenuOpen(false)
        }

        function closeOnEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') setAddMenuOpen(false)
        }

        document.addEventListener('mousedown', closeOnOutsideClick)
        window.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick)
            window.removeEventListener('keydown', closeOnEscape)
        }
    }, [addMenuOpen])

    return (
        <div className="shell__content-actions">
            {view !== 'groups' && view !== 'calendar' && (
                <div className="sort-dropdown" ref={sortMenuRef}>
                    <button
                        className={`sort-dropdown__trigger ${sortMenuOpen ? 'is-open' : ''}`}
                        type="button"
                        onClick={onToggleSortMenu}
                        aria-haspopup="listbox"
                        aria-expanded={sortMenuOpen}
                        aria-label="Sort files"
                        title="Sort files"
                    >
                        <span className="sort-dropdown__icon" aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M4 7h10M4 12h7M4 17h4M18 6v12m0 0 3-3m-3 3-3-3"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </span>
                        <span className="sort-dropdown__text">
                            <span className="sort-dropdown__label">Sort by</span>
                            <span className="sort-dropdown__value">{FILE_SORT_LABELS[sortKey]}</span>
                        </span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                                d="m7 10 5 5 5-5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </button>

                    {sortMenuOpen && (
                        <div
                            className={`sort-dropdown__menu sort-dropdown__menu--animated ${
                                sortMenuClosing ? 'is-closing' : 'is-opening'
                            }`}
                            role="listbox"
                            aria-label="Sort files"
                        >
                            {Object.entries(FILE_SORT_LABELS).map(([value, label]) => (
                                <button
                                    key={value}
                                    className={`sort-dropdown__option ${sortKey === value ? 'is-selected' : ''}`}
                                    type="button"
                                    role="option"
                                    aria-selected={sortKey === value}
                                    onClick={() => {
                                        onSortKeyChange(value as FileSortKey)
                                        onCloseSortMenu()
                                    }}
                                >
                                    <span>{label}</span>
                                    {sortKey === value && (
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path
                                                d="M5 12.5 9.3 17 19 7"
                                                stroke="currentColor"
                                                strokeWidth="1.9"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {view !== 'groups' && view !== 'calendar' && (
                <div className="sort-dropdown file-filter" ref={filterMenuRef}>
                    <button
                        className={`sort-dropdown__trigger file-filter__trigger ${
                            filterMenuOpen ? 'is-open' : ''
                        } ${hasActiveFilter ? 'has-filter' : ''}`}
                        type="button"
                        onClick={onToggleFilterMenu}
                        aria-haspopup="dialog"
                        aria-expanded={filterMenuOpen}
                        aria-label="Filter files"
                        title="Filter files"
                    >
                        <span className="sort-dropdown__icon" aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M4 6h16l-6.2 7.1V18l-3.6 1.8v-6.7L4 6Z"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </span>
                        <span className="sort-dropdown__text">
                            <span className="sort-dropdown__label">Filter</span>
                            <span className="sort-dropdown__value">{filterSummary}</span>
                        </span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                                d="m7 10 5 5 5-5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </button>

                    <FileFilterModal
                        isOpen={filterMenuOpen}
                        isClosing={filterMenuClosing}
                        filterSummary={filterSummary}
                        query={query}
                        fileFilters={fileFilters}
                        hasActiveFilter={hasActiveFilter}
                        sizeSliderMax={sizeSliderMax}
                        sizeSliderMinValue={sizeSliderMinValue}
                        sizeSliderMaxValue={sizeSliderMaxValue}
                        sizeSliderMinPct={sizeSliderMinPct}
                        sizeSliderMaxPct={sizeSliderMaxPct}
                        onClose={onCloseFilterMenu}
                        onQueryChange={onQueryChange}
                        onClearFileTypes={onClearFileTypes}
                        onToggleFileType={onToggleFileType}
                        onVisibilityChange={onVisibilityChange}
                        onSizeInputChange={onSizeInputChange}
                        onSizeSliderChange={onSizeSliderChange}
                        onExcludedExtensionsChange={onExcludedExtensionsChange}
                        onModifiedDateChange={onModifiedDateChange}
                        onClearFilters={onClearFilters}
                    />
                </div>
            )}

            {view !== 'calendar' && (
                <div
                    className={`view-toggle view-toggle--${layoutMode} ${
                        layoutSwitchTarget ? 'is-switching' : ''
                    }`}
                    role="group"
                    aria-label="File layout"
                >
                    <button
                        className={`view-toggle__button ${layoutMode === 'grid' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => onLayoutModeChange('grid')}
                        aria-label="Grid view"
                        aria-pressed={layoutMode === 'grid'}
                        title="Grid view"
                    >
                        {GRID_VIEW_ICON}
                    </button>
                    <button
                        className={`view-toggle__button ${layoutMode === 'list' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => onLayoutModeChange('list')}
                        aria-label="List view"
                        aria-pressed={layoutMode === 'list'}
                        title="List view"
                    >
                        {LIST_VIEW_ICON}
                    </button>
                </div>
            )}

            {view === 'all' && (
                <div className="add-dropdown" ref={addMenuRef}>
                    <button
                        className={`btn btn--solid add-dropdown__trigger ${addMenuOpen ? 'is-open' : ''}`}
                        type="button"
                        onClick={() => setAddMenuOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={addMenuOpen}
                    >
                        Add
                    </button>
                    {addMenuOpen && (
                        <div className="add-dropdown__menu" role="menu" aria-label="Add to vault">
                            <button
                                className="add-dropdown__item"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setAddMenuOpen(false)
                                    onOpenFileCreate()
                                }}
                            >
                                New file
                            </button>
                            <button
                                className="add-dropdown__item"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setAddMenuOpen(false)
                                    onOpenFolderCreate()
                                }}
                            >
                                New folder
                            </button>
                            <button
                                className="add-dropdown__item"
                                type="button"
                                role="menuitem"
                                onClick={() => uploadInputRef.current?.click()}
                            >
                                Upload files
                            </button>
                            <input
                                ref={uploadInputRef}
                                className="add-dropdown__input"
                                type="file"
                                multiple
                                onChange={(event) => {
                                    setAddMenuOpen(false)
                                    onUploadChange(event)
                                }}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
