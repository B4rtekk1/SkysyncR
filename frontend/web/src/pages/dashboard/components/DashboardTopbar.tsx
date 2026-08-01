import { useEffect, useRef, type RefObject } from 'react'
import ThemeToggle from '../../../components/ThemeToggle'
import { SIDEBAR_SHOW_ICON } from '../icons'
import { NotificationCenter } from './NotificationCenter'

type DashboardTopbarProps = {
    sidebarHidden: boolean
    searchInputRef: RefObject<HTMLInputElement | null>
    query: string
    displayName: string
    avatarUrl: string
    menuOpen: boolean
    menuRef: RefObject<HTMLDivElement | null>
    onShowSidebar: () => void
    onQueryChange: (value: string) => void
    onToggleMenu: () => void
    onSignOut: () => void
}

export function DashboardTopbar({
    sidebarHidden,
    searchInputRef,
    query,
    displayName,
    avatarUrl,
    menuOpen,
    menuRef,
    onShowSidebar,
    onQueryChange,
    onToggleMenu,
    onSignOut,
}: DashboardTopbarProps) {
    const shortcutsRef = useRef<HTMLDetailsElement>(null)

    useEffect(() => {
        function closeShortcutsOnOutsideClick(event: MouseEvent) {
            if (!shortcutsRef.current?.contains(event.target as Node)) {
                shortcutsRef.current?.removeAttribute('open')
            }
        }

        document.addEventListener('mousedown', closeShortcutsOnOutsideClick)
        return () => document.removeEventListener('mousedown', closeShortcutsOnOutsideClick)
    }, [])

    return (
        <header className="shell__topbar">
            {sidebarHidden && (
                <button
                    className="shell__show-sidebar"
                    type="button"
                    onClick={onShowSidebar}
                    aria-label="Show navigation"
                    title="Show navigation"
                >
                    {SIDEBAR_SHOW_ICON}
                </button>
            )}
            <label className="shell__search" data-tour="search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M20 20l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                <input
                    ref={searchInputRef}
                    type="search"
                    aria-label="Search your vault"
                    placeholder="Press / to search"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                />
                <button
                    className={`shell__search-clear ${query ? '' : 'is-hidden'}`}
                    type="button"
                    onClick={() => onQueryChange('')}
                    aria-label="Clear search"
                    title="Clear search"
                    tabIndex={query ? 0 : -1}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="m7 7 10 10M17 7 7 17"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
            </label>

            <details ref={shortcutsRef} className="shell__shortcuts">
                <summary>
                    <span aria-hidden="true">⌨</span>
                    Keyboard shortcuts
                </summary>
                <div className="shell__shortcuts-panel">
                    <p className="shell__shortcuts-title">Available shortcuts</p>
                    <dl>
                        <div><dt><kbd>/</kbd></dt><dd>Focus search</dd></div>
                        <div><dt><kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>A</kbd></dt><dd>Select all visible</dd></div>
                        <div><dt><kbd>N</kbd></dt><dd>New file</dd></div>
                        <div><dt><kbd>Shift</kbd> + <kbd>N</kbd></dt><dd>New folder</dd></div>
                        <div><dt><kbd>Enter</kbd></dt><dd>Open selected item</dd></div>
                        <div><dt><kbd>Esc</kbd></dt><dd>Clear selection or search</dd></div>
                        <div><dt><kbd>Delete</kbd></dt><dd>Delete selected items</dd></div>
                    </dl>
                </div>
            </details>

            <div className="shell__topbar-actions">
                <span className="shell__sync">
                    synced &middot; encrypted
                </span>

                <ThemeToggle className="shell__theme-toggle" />

                <NotificationCenter />

                <div className="shell__user" ref={menuRef} data-tour="account">
                    <button className="shell__avatar" onClick={onToggleMenu} aria-label="Account menu">
                        {avatarUrl ? <img src={avatarUrl} alt="" /> : displayName.charAt(0).toUpperCase()}
                    </button>
                    {menuOpen && (
                        <div className="shell__menu">
                            <p className="shell__menu-name">{displayName}</p>
                            <button className="shell__menu-item" onClick={onSignOut}>
                                Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}
