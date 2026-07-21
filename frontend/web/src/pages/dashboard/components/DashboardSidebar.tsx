import React, {
    type DragEvent,
    type KeyboardEventHandler,
    type PointerEventHandler,
    type RefObject,
} from 'react'
import { Link } from 'react-router-dom'
import type { StorageQuota } from '../../../api/files'
import {
    DRAG_HANDLE_ICON,
    NAV_ICONS,
    SETTINGS_ICON,
    SIDEBAR_HIDE_ICON,
} from '../icons'
import { KIND_ACCENT, KIND_LABELS, formatBytes } from '../fileUtils'
import { NAV_LABELS } from '../storage'
import type { NavIndicator, ViewKey } from '../types'

type StorageBreakdownItem = {
    kind: keyof typeof KIND_LABELS
    bytes: number
}

type DashboardSidebarProps = {
    sidebarHidden: boolean
    navListRef: RefObject<HTMLElement | null>
    navItemRefs: RefObject<Partial<Record<ViewKey, HTMLButtonElement>>>
    navIndicator: NavIndicator
    navIndicatorPulling: boolean
    navOrder: ViewKey[]
    view: ViewKey
    draggedNavKey: ViewKey | null
    dropNavTarget: ViewKey | null
    quota: StorageQuota | null
    usedPct: number
    storageStatus: string
    storageStatusText: string
    storageBreakdown: StorageBreakdownItem[]
    storageBreakdownTotal: number
    onHideSidebar: () => void
    onStartSidebarResize: PointerEventHandler<HTMLButtonElement>
    onResizeSidebarWithKeyboard: KeyboardEventHandler<HTMLButtonElement>
    onSelectNavView: (key: ViewKey) => void
    onNavDragStart: (key: ViewKey, e: DragEvent<HTMLButtonElement>) => void
    onNavDragEnter: (key: ViewKey) => void
    onNavDragLeave: (key: ViewKey) => void
    onNavDrop: (key: ViewKey, e: DragEvent<HTMLButtonElement>) => void
    onNavDragEnd: () => void
    onMoveNavItem: (key: ViewKey, offset: number) => void
    onOpenSettings: () => void
}

export function DashboardSidebar({
    sidebarHidden,
    navListRef,
    navItemRefs,
    navIndicator,
    navIndicatorPulling,
    navOrder,
    view,
    draggedNavKey,
    dropNavTarget,
    quota,
    usedPct,
    storageStatus,
    storageStatusText,
    storageBreakdown,
    storageBreakdownTotal,
    onHideSidebar,
    onStartSidebarResize,
    onResizeSidebarWithKeyboard,
    onSelectNavView,
    onNavDragStart,
    onNavDragEnter,
    onNavDragLeave,
    onNavDrop,
    onNavDragEnd,
    onMoveNavItem,
    onOpenSettings,
}: DashboardSidebarProps) {
    return (
        <aside className="shell__sidebar" aria-hidden={sidebarHidden}>
            <Link to="/dashboard" className="shell__logo">
                <span className="nav__logo-mark" aria-hidden="true" />
                <span className="shell__sidebar-label">SkysyncR</span>
            </Link>

            <button
                className="shell__sidebar-toggle"
                type="button"
                onClick={onHideSidebar}
                aria-label="Hide navigation"
                title="Hide navigation"
            >
                {SIDEBAR_HIDE_ICON}
            </button>

            <button
                className="shell__resize-handle"
                type="button"
                onPointerDown={onStartSidebarResize}
                onKeyDown={onResizeSidebarWithKeyboard}
                aria-label="Resize navigation"
                aria-keyshortcuts="ArrowLeft ArrowRight"
                title="Drag to resize navigation"
            />

            <nav
                className="shell__navlist shell__navlist--primary"
                ref={navListRef}
                style={
                    {
                        '--nav-indicator-x': `${navIndicator.x}px`,
                        '--nav-indicator-y': `${navIndicator.y}px`,
                        '--nav-indicator-width': `${navIndicator.width}px`,
                        '--nav-indicator-height': `${navIndicator.height}px`,
                        '--nav-indicator-opacity': navIndicator.visible ? 1 : 0,
                    } as React.CSSProperties
                }
            >
                <span
                    className={`shell__nav-indicator ${navIndicatorPulling ? 'is-pulling' : ''}`}
                    aria-hidden="true"
                />
                {navOrder.map((key) => (
                    <button
                        key={key}
                        ref={(node) => {
                            if (node) {
                                navItemRefs.current[key] = node
                            } else {
                                delete navItemRefs.current[key]
                            }
                        }}
                        className={`shell__navitem ${view === key ? 'is-active' : ''} ${
                            draggedNavKey === key ? 'is-dragging-nav' : ''
                        } ${dropNavTarget === key ? 'is-drop-target-nav' : ''}`}
                        onClick={() => onSelectNavView(key)}
                        onKeyDown={(e) => {
                            if (!e.altKey) return
                            const offset = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
                            if (offset === 0) return

                            e.preventDefault()
                            onMoveNavItem(key, offset)
                        }}
                        draggable
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
                        onDragStart={(e) => onNavDragStart(key, e)}
                        onDragEnter={(e) => {
                            e.preventDefault()
                            onNavDragEnter(key)
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDragLeave={() => onNavDragLeave(key)}
                        onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onNavDrop(key, e)
                        }}
                        onDragEnd={onNavDragEnd}
                    >
                        <span className="shell__navicon shell__navicon--handle">{DRAG_HANDLE_ICON}</span>
                        <span className="shell__navicon">{NAV_ICONS[key]}</span>
                        <span className="shell__sidebar-label">{NAV_LABELS[key]}</span>
                    </button>
                ))}
            </nav>

            <nav className="shell__navlist shell__navlist--footer">
                <button className="shell__navitem" type="button" onClick={onOpenSettings}>
                    <span className="shell__navicon">{SETTINGS_ICON}</span>
                    <span className="shell__sidebar-label">Settings</span>
                </button>
            </nav>

            <div className="shell__storage">
                <div className="shell__storage-row">
                    <span>Storage</span>
                    <span>{quota ? `${formatBytes(quota.used_bytes)} / ${formatBytes(quota.total_bytes)}` : '-'}</span>
                </div>
                <div className="shell__storage-summary">
                    <strong>{quota ? `${usedPct}% used` : 'Quota unavailable'}</strong>
                    <span className={`shell__storage-status shell__storage-status--${storageStatus}`}>
                        {quota ? storageStatusText : 'Check connection'}
                    </span>
                </div>
                <div className="shell__storage-bar">
                    <div
                        className={`shell__storage-fill shell__storage-fill--${storageStatus}`}
                        style={{ width: `${usedPct}%` }}
                    />
                </div>
                <div className="shell__storage-breakdown" aria-label="Storage by file type">
                    {storageBreakdown.length > 0 ? (
                        storageBreakdown.map((item) => {
                            const percent = storageBreakdownTotal
                                ? Math.max(3, Math.round((item.bytes / storageBreakdownTotal) * 100))
                                : 0
                            return (
                                <div className="shell__storage-type" key={item.kind}>
                                    <div className="shell__storage-type-row">
                                        <span>{KIND_LABELS[item.kind]}</span>
                                        <span>{formatBytes(item.bytes)}</span>
                                    </div>
                                    <div className="shell__storage-type-bar">
                                        <div
                                            className="shell__storage-type-fill"
                                            style={{
                                                width: `${percent}%`,
                                                background: KIND_ACCENT[item.kind],
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        })
                    ) : (
                        <p className="shell__storage-empty">No files counted yet</p>
                    )}
                </div>
            </div>
        </aside>
    )
}
