import type { CSSProperties } from 'react'
import {
    FILE_TYPE_FILTER_LABELS,
    FILE_TYPE_FILTER_OPTIONS,
    FILE_VISIBILITY_LABELS,
    formatSizeFromKb,
    formatSizeInputValue,
} from './fileFilters'
import type { FileFilters, FileTypeFilterKey, FileVisibilityFilterKey } from './types'

type SizeFilterField = 'minSizeMb' | 'maxSizeMb'
type ModifiedDateField = 'modifiedFrom' | 'modifiedTo'

type FileFilterModalProps = {
    isOpen: boolean
    isClosing: boolean
    filterSummary: string
    query: string
    fileFilters: FileFilters
    hasActiveFilter: boolean
    sizeSliderMax: number
    sizeSliderMinValue: number
    sizeSliderMaxValue: number
    sizeSliderMinPct: number
    sizeSliderMaxPct: number
    onClose: () => void
    onQueryChange: (query: string) => void
    onClearFileTypes: () => void
    onToggleFileType: (type: FileTypeFilterKey) => void
    onVisibilityChange: (visibility: FileVisibilityFilterKey) => void
    onSizeInputChange: (field: SizeFilterField, value: string) => void
    onSizeSliderChange: (field: SizeFilterField, value: string) => void
    onExcludedExtensionsChange: (value: string) => void
    onModifiedDateChange: (field: ModifiedDateField, value: string) => void
    onClearFilters: () => void
}

export function FileFilterModal({
    isOpen,
    isClosing,
    filterSummary,
    query,
    fileFilters,
    hasActiveFilter,
    sizeSliderMax,
    sizeSliderMinValue,
    sizeSliderMaxValue,
    sizeSliderMinPct,
    sizeSliderMaxPct,
    onClose,
    onQueryChange,
    onClearFileTypes,
    onToggleFileType,
    onVisibilityChange,
    onSizeInputChange,
    onSizeSliderChange,
    onExcludedExtensionsChange,
    onModifiedDateChange,
    onClearFilters,
}: FileFilterModalProps) {
    if (!isOpen) return null

    return (
        <div
            className={`file-filter__modal ${isClosing ? 'is-closing' : 'is-opening'}`}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div
                className="file-filter__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="file-filter-title"
            >
                <div className="file-filter__modal-head">
                    <div>
                        <h2 id="file-filter-title">Filter files</h2>
                        <span>{filterSummary}</span>
                    </div>
                    <button
                        type="button"
                        className="file-filter__close"
                        onClick={onClose}
                        aria-label="Close filters"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                                d="m6 6 12 12M18 6 6 18"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </div>
                <div className="file-filter__modal-body">
                    <div className="file-filter__section file-filter__section--search">
                        <div className="file-filter__section-head">
                            <span>Search</span>
                        </div>
                        <label className="file-filter__search">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                                <path d="M20 20l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search files"
                                value={query}
                                onChange={(e) => onQueryChange(e.target.value)}
                            />
                        </label>
                    </div>
                    <div className="file-filter__modal-grid">
                        <div className="file-filter__section">
                            <div className="file-filter__section-head">
                                <span>File types</span>
                                {fileFilters.types.length > 0 && (
                                    <button type="button" className="file-filter__link" onClick={onClearFileTypes}>
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="file-filter__type-grid">
                                {FILE_TYPE_FILTER_OPTIONS.map((type) => (
                                    <label
                                        key={type}
                                        className={`file-filter__check ${
                                            fileFilters.types.includes(type) ? 'is-selected' : ''
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={fileFilters.types.includes(type)}
                                            onChange={() => onToggleFileType(type)}
                                        />
                                        <span>{FILE_TYPE_FILTER_LABELS[type]}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="file-filter__section">
                            <div className="file-filter__section-head">
                                <span>Sharing</span>
                            </div>
                            <div className="file-filter__segments">
                                {(Object.keys(FILE_VISIBILITY_LABELS) as FileVisibilityFilterKey[]).map((visibility) => (
                                    <button
                                        key={visibility}
                                        type="button"
                                        className={`file-filter__segment ${
                                            fileFilters.visibility === visibility ? 'is-selected' : ''
                                        }`}
                                        onClick={() => onVisibilityChange(visibility)}
                                    >
                                        {FILE_VISIBILITY_LABELS[visibility]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="file-filter__section">
                            <div className="file-filter__section-head">
                                <span>Size range</span>
                                <span>
                                    {formatSizeFromKb(sizeSliderMinValue)} - {formatSizeFromKb(sizeSliderMaxValue)}
                                </span>
                            </div>
                            <div className="file-filter__range-stack">
                                <div className="file-filter__range-labels">
                                    <span>Min {formatSizeFromKb(sizeSliderMinValue)}</span>
                                    <span>Max {formatSizeFromKb(sizeSliderMaxValue)}</span>
                                </div>
                                <div
                                    className="file-filter__range-dual"
                                    style={
                                        {
                                            '--range-min': `${sizeSliderMinPct}%`,
                                            '--range-max': `${sizeSliderMaxPct}%`,
                                        } as CSSProperties
                                    }
                                >
                                    <input
                                        type="range"
                                        min="0"
                                        max={sizeSliderMax}
                                        value={sizeSliderMinValue}
                                        onChange={(e) => onSizeSliderChange('minSizeMb', e.target.value)}
                                        aria-label="Minimum file size"
                                    />
                                    <input
                                        type="range"
                                        min="0"
                                        max={sizeSliderMax}
                                        value={sizeSliderMaxValue}
                                        onChange={(e) => onSizeSliderChange('maxSizeMb', e.target.value)}
                                        aria-label="Maximum file size"
                                    />
                                </div>
                                <div className="file-filter__size-row">
                                    <input
                                        type="text"
                                        placeholder="Min"
                                        value={formatSizeInputValue(fileFilters.minSizeMb)}
                                        onChange={(e) => onSizeInputChange('minSizeMb', e.target.value)}
                                        aria-label="Minimum file size"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Max"
                                        value={formatSizeInputValue(fileFilters.maxSizeMb)}
                                        onChange={(e) => onSizeInputChange('maxSizeMb', e.target.value)}
                                        aria-label="Maximum file size"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="file-filter__section">
                            <div className="file-filter__section-head">
                                <span>Exclude extensions</span>
                            </div>
                            <input
                                className="file-filter__text-input"
                                type="text"
                                placeholder="exe, zip, .tmp"
                                value={fileFilters.excludedExtensions}
                                onChange={(e) => onExcludedExtensionsChange(e.target.value)}
                                aria-label="Excluded file extensions"
                            />
                        </div>

                        <div className="file-filter__section">
                            <div className="file-filter__section-head">
                                <span>Modified date</span>
                            </div>
                            <div className="file-filter__size-row">
                                <input
                                    type="date"
                                    value={fileFilters.modifiedFrom}
                                    onChange={(e) => onModifiedDateChange('modifiedFrom', e.target.value)}
                                    aria-label="Modified from"
                                />
                                <input
                                    type="date"
                                    value={fileFilters.modifiedTo}
                                    onChange={(e) => onModifiedDateChange('modifiedTo', e.target.value)}
                                    aria-label="Modified to"
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="file-filter__footer">
                    <button
                        type="button"
                        className="file-filter__clear"
                        onClick={onClearFilters}
                        disabled={!hasActiveFilter}
                    >
                        Reset filters
                    </button>
                    <button type="button" className="file-filter__done" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    )
}
