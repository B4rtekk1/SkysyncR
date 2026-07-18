import { useState, type Dispatch, type SetStateAction } from 'react'
import { updateFileNote, type ApiFile } from '../../../api/files'
import { encryptTextEnvelope, unwrapFileKeyForUser } from '../../../crypto/fileEncryption'
import type { Item } from '../types'

type UseNoteActionsOptions = {
    privateKey: CryptoKey | null
    setItems: Dispatch<SetStateAction<Item[]>>
    setStorageItems: Dispatch<SetStateAction<ApiFile[]>>
    setError: Dispatch<SetStateAction<string | null>>
}

export function useNoteActions({
    privateKey,
    setItems,
    setStorageItems,
    setError,
}: UseNoteActionsOptions) {
    const [noteItem, setNoteItem] = useState<Item | null>(null)
    const [noteSaving, setNoteSaving] = useState(false)

    async function handleSaveNote(item: Item, note: string) {
        setNoteSaving(true)
        setError(null)
        if (!privateKey) {
            setError('Private key is locked. Sign in again to save encrypted notes.')
            setNoteSaving(false)
            return
        }

        try {
            const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
            const encryptedNote = note.trim() ? await encryptTextEnvelope(note, fileKey) : ''
            const updated = await updateFileNote(item.id, encryptedNote)
            setItems((prev) =>
                prev.map((current) =>
                    current.id === item.id
                        ? { ...updated, filename: current.filename, mime_type: current.mime_type, note: note.trim() ? note : null }
                        : current,
                ),
            )
            setStorageItems((prev) =>
                prev.map((current) =>
                    current.id === item.id
                        ? { ...updated, filename: current.filename, mime_type: current.mime_type, note: note.trim() ? note : null }
                        : current,
                ),
            )
            setNoteItem(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the note.')
            throw e
        } finally {
            setNoteSaving(false)
        }
    }

    return {
        noteItem,
        setNoteItem,
        noteSaving,
        handleSaveNote,
    }
}
