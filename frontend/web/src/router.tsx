/* eslint-disable react-refresh/only-export-components */
import {
    Children,
    createContext,
    isValidElement,
    type AnchorHTMLAttributes,
    type MouseEvent,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useSyncExternalStore,
} from 'react'

type NavigateOptions = {
    replace?: boolean
    state?: unknown
}

export type NavigateFunction = (to: string, options?: NavigateOptions) => void

type LocationState = {
    pathname: string
    search: string
    hash: string
    state: unknown
}

type RouterContextValue = {
    location: LocationState
    navigate: NavigateFunction
}

type RouteProps = {
    path: string
    element: ReactNode
}

const RouterContext = createContext<RouterContextValue | null>(null)
const ParamsContext = createContext<Record<string, string | undefined>>({})
let cachedLocation: LocationState | null = null

function getLocation(): LocationState {
    const next = {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        state: window.history.state ?? null,
    }

    if (
        cachedLocation &&
        cachedLocation.pathname === next.pathname &&
        cachedLocation.search === next.search &&
        cachedLocation.hash === next.hash &&
        cachedLocation.state === next.state
    ) {
        return cachedLocation
    }

    cachedLocation = next
    return cachedLocation
}

function subscribeToLocationChange(onStoreChange: () => void) {
    window.addEventListener('popstate', onStoreChange)
    window.addEventListener('skysync:navigate', onStoreChange)

    return () => {
        window.removeEventListener('popstate', onStoreChange)
        window.removeEventListener('skysync:navigate', onStoreChange)
    }
}

function resolveUrl(to: string) {
    return new URL(to, window.location.origin)
}

function normalizePath(path: string) {
    return path.replace(/\/+$/, '') || '/'
}

function matchRoute(pattern: string, pathname: string) {
    if (pattern === '*') return { matched: true, params: {} }

    const patternParts = normalizePath(pattern).split('/').filter(Boolean)
    const pathParts = normalizePath(pathname).split('/').filter(Boolean)

    if (patternParts.length !== pathParts.length) {
        return { matched: false, params: {} }
    }

    const params: Record<string, string | undefined> = {}

    for (let index = 0; index < patternParts.length; index += 1) {
        const patternPart = patternParts[index]
        const pathPart = pathParts[index]

        if (!patternPart || !pathPart) return { matched: false, params: {} }

        if (patternPart.startsWith(':')) {
            params[patternPart.slice(1)] = decodeURIComponent(pathPart)
        } else if (patternPart !== pathPart) {
            return { matched: false, params: {} }
        }
    }

    return { matched: true, params }
}

function notifyNavigation() {
    window.dispatchEvent(new Event('skysync:navigate'))
}

export function BrowserRouter({ children }: { children: ReactNode }) {
    const location = useSyncExternalStore(subscribeToLocationChange, getLocation, getLocation)
    const navigate = useCallback<NavigateFunction>((to, options) => {
        const url = resolveUrl(to)
        const next = `${url.pathname}${url.search}${url.hash}`

        if (options?.replace) {
            window.history.replaceState(options.state ?? null, '', next)
        } else {
            window.history.pushState(options?.state ?? null, '', next)
        }

        notifyNavigation()
    }, [])

    const value = useMemo(() => ({ location, navigate }), [location, navigate])

    return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function Routes({ children }: { children: ReactNode }) {
    const { location } = useRouter()
    const routes = Children.toArray(children)

    for (const child of routes) {
        if (!isValidElement<RouteProps>(child)) continue

        const match = matchRoute(child.props.path, location.pathname)
        if (match.matched) {
            return <ParamsContext.Provider value={match.params}>{child.props.element}</ParamsContext.Provider>
        }
    }

    return null
}

export function Route(props: RouteProps) {
    void props
    return null
}

export function Link({
    to,
    onClick,
    children,
    ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    to: string
}) {
    const navigate = useNavigate()

    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        onClick?.(event)
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey ||
            props.target
        ) {
            return
        }

        event.preventDefault()
        navigate(to)
    }

    return (
        <a {...props} href={to} onClick={handleClick}>
            {children}
        </a>
    )
}

export function useNavigate() {
    return useRouter().navigate
}

export function useLocation() {
    return useRouter().location
}

export function useParams() {
    return useContext(ParamsContext)
}

function useRouter() {
    const context = useContext(RouterContext)
    if (!context) {
        throw new Error('Router hooks must be used inside BrowserRouter.')
    }

    return context
}
