export function describeApproximateLocation(ipAddress: string | null): string {
    if (!ipAddress) return 'Approximate location unavailable'

    const ip = ipAddress.trim()
    const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4) {
        const first = Number(ipv4[1])
        const second = Number(ipv4[2])
        if (first === 10 || first === 127 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31)) {
            return first === 127 ? 'This device - localhost' : `Private network - ${ip}`
        }
        return `Public network - ${ipv4[1]}.${ipv4[2]}.x.x`
    }

    const lowerIp = ip.toLowerCase()
    if (lowerIp === '::1') return 'This device - localhost'
    if (lowerIp.startsWith('fe80:') || lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) {
        return 'Private network - IPv6'
    }

    return `Public network - ${ip.slice(0, 12)}...`
}
