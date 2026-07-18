import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ApiFile } from '../../../api/files'
import { hasFileExtension, mimeTypeForCreatedFile } from '../createdFile'
import type { Item } from '../types'

type UseCreateFileOptions = {
    ingestFileArray: (files: File[]) => Promise<ApiFile[]>
    handleFilePreview: (item: Item, options?: { startEditing?: boolean }) => Promise<void>
    setError: Dispatch<SetStateAction<string | null>>
}

export function useCreateFile({ ingestFileArray, handleFilePreview, setError }: UseCreateFileOptions) {
    const [fileCreateOpen, setFileCreateOpen] = useState(false)
    const [fileNameDraft, setFileNameDraft] = useState('Untitled.txt')
    const [fileSaving, setFileSaving] = useState(false)

    function resetFileCreateDraft() {
        setFileCreateOpen(false)
        setFileNameDraft('Untitled.txt')
    }

    async function handleCreateFile() {
        const filename = fileNameDraft.trim()
        if (!filename || !hasFileExtension(filename) || fileSaving) return

        setFileSaving(true)
        setError(null)
        try {
            const file = new File([''], filename, {
                type: mimeTypeForCreatedFile(filename),
                lastModified: Date.now(),
            })
            const [created] = await ingestFileArray([file])
            if (created) {
                resetFileCreateDraft()
                await handleFilePreview(created, { startEditing: true })
            }
        } finally {
            setFileSaving(false)
        }
    }

    return {
        fileCreateOpen,
        setFileCreateOpen,
        fileNameDraft,
        setFileNameDraft,
        fileSaving,
        resetFileCreateDraft,
        handleCreateFile,
    }
}
