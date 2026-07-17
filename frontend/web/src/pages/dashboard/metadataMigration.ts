import { renameFile, updateFileNote, type ApiFile } from '../../api/files'
import {
    encryptTextEnvelope,
    isEncryptedTextEnvelope,
    unwrapFileKeyForUser,
} from '../../crypto/fileEncryption'

export async function migratePlaintextFileMetadata(files: ApiFile[], privateKey: CryptoKey) {
    await Promise.allSettled(
        files.map(async (file) => {
            const shouldEncryptFilename = !isEncryptedTextEnvelope(file.filename)
            const shouldEncryptNote = Boolean(file.note) && !isEncryptedTextEnvelope(file.note)
            if (!shouldEncryptFilename && !shouldEncryptNote) return

            const fileKey = await unwrapFileKeyForUser(file.encrypted_key, privateKey)
            await Promise.all([
                shouldEncryptFilename
                    ? renameFile(file.id, await encryptTextEnvelope(file.filename, fileKey))
                    : Promise.resolve(),
                shouldEncryptNote && file.note
                    ? updateFileNote(file.id, await encryptTextEnvelope(file.note, fileKey))
                    : Promise.resolve(),
            ])
        }),
    )
}
