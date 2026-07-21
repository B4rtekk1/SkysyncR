import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import '../App.css'
import ThemeToggle from '../components/ThemeToggle'
import { downloadPublicFile, verifyBlobChecksum } from '../api/files'
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

async function decryptMaybeEncryptedMetadata(value: string, fileKey: CryptoKey): Promise<string> {
  if (!isEncryptedTextEnvelope(value)) return value
  return decryptTextEnvelope(value, fileKey)
}

function PublicShare() {
  const { token } = useParams()
  const [status, setStatus] = useState<ShareStatus>('loading')
  const [message, setMessage] = useState('Preparing download...')

  useEffect(() => {
    let active = true

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
        const rawFileKey = fileKeyFromLocationHash()
        if (!rawFileKey) {
          showError('This secure share link is missing its decryption key.')
          return
        }

        const file = await downloadPublicFile(token)
        await verifyBlobChecksum(file.blob, file.checksum)
        if (!file.encryptionNonce) {
          showError('This secure share link is missing encryption metadata.')
          return
        }

        const fileKey = await importRawFileKey(base64UrlToBuffer(rawFileKey))
        const [filename, mimeType] = await Promise.all([
          decryptMaybeEncryptedMetadata(file.filename, fileKey),
          file.mimeType ? decryptMaybeEncryptedMetadata(file.mimeType, fileKey) : Promise.resolve(null),
        ])
        const decryptedBlob = isChunkedFileNonce(file.encryptionNonce)
          ? await streamToBlob(decryptFileStream(file.blob, fileKey, file.encryptionNonce), mimeType)
          : await decryptFile(file.blob, fileKey, file.encryptionNonce, mimeType)

        if (!active) return
        saveBlob(decryptedBlob, filename)
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
  }, [token])

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
          Shared file
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
