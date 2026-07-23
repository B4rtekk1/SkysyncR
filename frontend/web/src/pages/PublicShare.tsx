import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import '../App.css'
import ThemeToggle from '../components/ThemeToggle'
import {
  downloadPublicFile,
  downloadPublicFolderFile,
  getPublicFolderManifest,
  verifyBlobChecksum,
  type ApiFile,
  type ApiFolder,
} from '../api/files'
import {
  base64UrlToBuffer,
  decryptFile,
  decryptFileStream,
  decryptTextEnvelope,
  importRawFileKey,
  isChunkedFileNonce,
  isEncryptedTextEnvelope,
  streamToBlob,
} from '../crypto/fileEncryption'
import { createZip, safeZipName, uniqueZipPath } from './dashboard/zip'

type ShareStatus = 'loading' | 'ready' | 'error'

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function fileKeyFromLocationHash(): string | null {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const params = new URLSearchParams(hash)
  return params.get('key')
}

type PublicFolderKeyring = {
  v: 1
  folders: Record<string, string>
  files: Record<string, string>
}

type DecryptedFolder = ApiFolder & { name: string }

function folderKeyringFromLocationHash(): PublicFolderKeyring | null {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const params = new URLSearchParams(hash)
  const value = params.get('keys')
  if (!value) return null

  try {
    const decoded = new TextDecoder().decode(base64UrlToBuffer(value))
    const parsed: unknown = JSON.parse(decoded)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { folders?: unknown }).folders === 'object' &&
      typeof (parsed as { files?: unknown }).files === 'object'
    ) {
      return parsed as PublicFolderKeyring
    }
  } catch {
    return null
  }

  return null
}

async function decryptMaybeEncryptedMetadata(value: string, fileKey: CryptoKey): Promise<string> {
  if (!isEncryptedTextEnvelope(value)) return value
  return decryptTextEnvelope(value, fileKey)
}

function PublicShare() {
  const { token } = useParams()
  const isFolderShare = window.location.pathname.includes('/share/folders/')
  const [status, setStatus] = useState<ShareStatus>('loading')
  const [message, setMessage] = useState('Preparing download...')

  useEffect(() => {
    let active = true

    async function downloadFileShare(shareToken: string) {
      const rawFileKey = fileKeyFromLocationHash()
      if (!rawFileKey) {
        throw new Error('This secure share link is missing its decryption key.')
      }

      const file = await downloadPublicFile(shareToken)
      await verifyBlobChecksum(file.blob, file.checksum)
      if (!file.encryptionNonce) {
        throw new Error('This secure share link is missing encryption metadata.')
      }

      const fileKey = await importRawFileKey(base64UrlToBuffer(rawFileKey))
      const [filename, mimeType] = await Promise.all([
        decryptMaybeEncryptedMetadata(file.filename, fileKey),
        file.mimeType ? decryptMaybeEncryptedMetadata(file.mimeType, fileKey) : Promise.resolve(null),
      ])
      const decryptedBlob = isChunkedFileNonce(file.encryptionNonce)
        ? await streamToBlob(decryptFileStream(file.blob, fileKey, file.encryptionNonce), mimeType)
        : await decryptFile(file.blob, fileKey, file.encryptionNonce, mimeType)

      saveBlob(decryptedBlob, filename)
    }

    async function downloadFolderShare(shareToken: string) {
      const keyring = folderKeyringFromLocationHash()
      if (!keyring) {
        throw new Error('This secure folder link is missing its decryption keys.')
      }
      const shareKeys = keyring

      const manifest = await getPublicFolderManifest(shareToken)
      const keyCache = new Map<string, CryptoKey>()

      async function importKey(rawKey: string): Promise<CryptoKey> {
        const cached = keyCache.get(rawKey)
        if (cached) return cached
        const key = await importRawFileKey(base64UrlToBuffer(rawKey))
        keyCache.set(rawKey, key)
        return key
      }

      async function folderName(folder: ApiFolder): Promise<string> {
        const rawKey = shareKeys.folders[folder.id]
        if (!rawKey) throw new Error('This secure folder link is missing a folder key.')
        return decryptMaybeEncryptedMetadata(folder.name, await importKey(rawKey))
      }

      async function fileEntry(file: ApiFile, pathPrefix: string, usedPaths: Set<string>) {
        const rawKey = shareKeys.files[file.id]
        if (!rawKey) throw new Error('This secure folder link is missing a file key.')
        const fileKey = await importKey(rawKey)
        const downloaded = await downloadPublicFolderFile(shareToken, file.id)
        await verifyBlobChecksum(downloaded.blob, downloaded.checksum)
        if (!downloaded.encryptionNonce) {
          throw new Error('This secure folder link is missing encryption metadata.')
        }

        const [filename, mimeType] = await Promise.all([
          decryptMaybeEncryptedMetadata(file.filename, fileKey),
          downloaded.mimeType ? decryptMaybeEncryptedMetadata(downloaded.mimeType, fileKey) : Promise.resolve(null),
        ])
        const decryptedBlob = isChunkedFileNonce(downloaded.encryptionNonce)
          ? await streamToBlob(decryptFileStream(downloaded.blob, fileKey, downloaded.encryptionNonce), mimeType)
          : await decryptFile(downloaded.blob, fileKey, downloaded.encryptionNonce, mimeType)

        return {
          path: uniqueZipPath(`${pathPrefix}/${safeZipName(filename, 'file')}`, usedPaths),
          blob: decryptedBlob,
          modifiedAt: new Date(file.updated_at),
        }
      }

      const decryptedFolders = new Map<string, DecryptedFolder>()
      await Promise.all(
        manifest.folders.map(async (folder) => {
          decryptedFolders.set(folder.id, { ...folder, name: await folderName(folder) })
        }),
      )
      const root = decryptedFolders.get(manifest.root.id)
      if (!root) throw new Error('This secure folder link is invalid.')
      const rootFolder = root

      function folderPath(folderId: string | null): string {
        const folder = folderId ? decryptedFolders.get(folderId) : null
        if (!folder || folder.id === rootFolder.id) return safeZipName(rootFolder.name, 'folder')
        return `${folderPath(folder.parent_folder_id)}/${safeZipName(folder.name, 'folder')}`
      }

      const usedPaths = new Set<string>()
      const entries = await Promise.all(
        manifest.files.map((file) => fileEntry(file, folderPath(file.folder_id), usedPaths)),
      )
      saveBlob(await createZip(entries), `${safeZipName(rootFolder.name, 'folder')}.zip`)
    }

    async function download() {
      function showError(errorMessage: string) {
        if (!active) return
        setStatus('error')
        setMessage(errorMessage)
      }

      if (!token) {
        showError('This share link is invalid.')
        return
      }

      try {
        if (isFolderShare) {
          await downloadFolderShare(token)
        } else {
          await downloadFileShare(token)
        }
        if (!active) return
        setStatus('ready')
        setMessage('Your download has started.')
      } catch (err) {
        if (!active) return
        setStatus('error')
        setMessage(err instanceof Error ? err.message : 'This share link is invalid or has expired.')
      }
    }

    void download()

    return () => {
      active = false
    }
  }, [isFolderShare, token])

  return (
    <div className="page not-found-page">
      <nav className="nav nav--solid">
        <div className="nav__inner">
          <Link to="/" className="nav__logo">
            <span className="nav__logo-mark" aria-hidden="true" />
            SkysyncR
          </Link>
          <div className="nav__actions">
            <ThemeToggle className="nav__theme-toggle" />
            <Link to="/login" className="btn btn--ghost">Sign in</Link>
          </div>
        </div>
      </nav>

      <main className="not-found" aria-labelledby="share-title">
        <p className="not-found__code">{status === 'error' ? 'Share' : 'Download'}</p>
        <h1 id="share-title" className="not-found__title">
          {isFolderShare ? 'Shared folder' : 'Shared file'}
        </h1>
        <p className="not-found__copy">{message}</p>
        <div className="not-found__actions">
          {status === 'error' ? (
            <Link to="/" className="btn btn--solid btn--lg">
              Back to home
            </Link>
          ) : (
            <button
              className="btn btn--solid btn--lg"
              type="button"
              onClick={() => window.location.reload()}
              disabled={status === 'loading'}
            >
              Download again
            </button>
          )}
          <Link to="/dashboard" className="btn btn--outline btn--lg">
            Open dashboard
          </Link>
        </div>
      </main>
    </div>
  )
}

export default PublicShare
