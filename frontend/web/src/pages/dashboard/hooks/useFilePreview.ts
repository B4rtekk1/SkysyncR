import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadFile } from '../../../api/files'
import { decryptFile, unwrapFileKeyForUser } from '../../../crypto/fileEncryption'
import { kindFromFile } from '../fileUtils'
import type { ImagePreviewState, Item } from '../types'

export function useFilePreview(privateKey: CryptoKey | null, setError: (error: string | null) => void) {
    const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)
    const imagePreviewUrlRef = useRef<string | null>(null)
    const imagePreviewRequestRef = useRef(0)

    const decryptDownloadedFile = useCallback(async (item: Item): Promise<Blob> => {
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to unlock your vault.')
        }
        if (!item.encrypted_key || !item.encryption_nonce) {
            throw new Error('File encryption metadata is missing.')
        }

        const encryptedBlob = await downloadFile(item.id)
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        return decryptFile(encryptedBlob, fileKey, item.encryption_nonce, item.mime_type)
    }, [privateKey])

    const clearImagePreviewUrl = useCallback(() => {
        if (imagePreviewUrlRef.current) {
            URL.revokeObjectURL(imagePreviewUrlRef.current)
            imagePreviewUrlRef.current = null
        }
    }, [])

    const closeImagePreview = useCallback(() => {
        imagePreviewRequestRef.current += 1
        clearImagePreviewUrl()
        setImagePreview(null)
    }, [clearImagePreviewUrl])

    useEffect(() => {
        return () => {
            if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
        }
    }, [])

    useEffect(() => {
        if (!imagePreview) return

        function onKeyDown(e: globalThis.KeyboardEvent) {
            if (e.key === 'Escape') closeImagePreview()
        }

        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [closeImagePreview, imagePreview])

    async function handleDownload(item: Item) {
        try {
            const blob = await decryptDownloadedFile(item)
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = item.filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not download that file.')
        }
    }

    async function handleImagePreview(item: Item) {
        if (kindFromFile(item.filename, item.mime_type) !== 'image') return

        const requestId = imagePreviewRequestRef.current + 1
        imagePreviewRequestRef.current = requestId
        clearImagePreviewUrl()
        setError(null)
        setImagePreview({ item, url: null, loading: true })

        try {
            const previewBlob = await decryptDownloadedFile(item)
            const url = URL.createObjectURL(previewBlob)

            if (imagePreviewRequestRef.current !== requestId) {
                URL.revokeObjectURL(url)
                return
            }

            imagePreviewUrlRef.current = url
            setImagePreview({ item, url, loading: false })
        } catch (e) {
            if (imagePreviewRequestRef.current === requestId) {
                setImagePreview(null)
                setError(e instanceof Error ? e.message : 'Could not preview that image.')
            }
        }
    }

    return {
        imagePreview,
        closeImagePreview,
        handleDownload,
        handleImagePreview,
    }
}
