import { useEffect, useState } from 'react'
import ImageCropModal from './ImageCropModal'
import { processReceiptImage } from '../api/receipts'

/**
 * Square thumbnail with tap-to-recrop.
 *
 *   file   — File object (in-memory, not yet uploaded)
 *   src    — URL string (already uploaded image or PDF)
 *   onRemove()          — called when × is tapped
 *   onCropped(newFile)  — called after crop is confirmed
 *   reuploading         — shows spinner overlay while parent is re-uploading
 */
export default function CroppableThumb({ file, src, label = 'image', onRemove, onCropped, reuploading = false }) {
  const [thumbSrc, setThumbSrc] = useState(null)
  const [cropFile, setCropFile] = useState(null)  // File to hand to ImageCropModal
  const [cropSrc, setCropSrc] = useState(null)    // URL to hand to ImageCropModal
  const [converting, setConverting] = useState(false)

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setThumbSrc(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setThumbSrc(src || null)
    }
  }, [file, src])

  const isPdf = (f, s) =>
    f?.type === 'application/pdf' || f?.name?.toLowerCase().endsWith('.pdf') ||
    s?.toLowerCase().includes('.pdf') || s?.toLowerCase().includes('pdf')

  async function handleTap() {
    if (reuploading || converting) return

    if (file) {
      if (isPdf(file, null)) {
        // Convert PDF File to image first
        setConverting(true)
        try {
          const data = await processReceiptImage(file)
          const mimeType = data.content_type || 'image/jpeg'
          const byteStr = atob(data.processed_image)
          const arr = new Uint8Array(byteStr.length)
          for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
          const ext = mimeType === 'image/png' ? '.png' : '.jpg'
          setCropFile(new File([arr], file.name.replace(/\.pdf$/i, ext), { type: mimeType }))
        } catch {
          // fall back to passing src
        } finally {
          setConverting(false)
        }
      } else {
        setCropFile(file)
      }
    } else if (src) {
      if (isPdf(null, src)) {
        // Fetch PDF bytes, send to process-image
        setConverting(true)
        try {
          const resp = await fetch(src)
          const blob = await resp.blob()
          const pdfFile = new File([blob], 'attachment.pdf', { type: 'application/pdf' })
          const data = await processReceiptImage(pdfFile)
          const mimeType = data.content_type || 'image/jpeg'
          const byteStr = atob(data.processed_image)
          const arr = new Uint8Array(byteStr.length)
          for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
          setCropFile(new File([arr], 'attachment.jpg', { type: mimeType }))
        } catch {
          // silently ignore
        } finally {
          setConverting(false)
        }
      } else {
        setCropSrc(src)
      }
    }
  }

  function closeCrop() {
    setCropFile(null)
    setCropSrc(null)
  }

  const busy = reuploading || converting

  return (
    <>
      {(cropFile || cropSrc) && (
        <ImageCropModal
          file={cropFile || undefined}
          src={cropSrc || undefined}
          fileNumber={1}
          fileTotal={1}
          onConfirm={(croppedFile) => {
            closeCrop()
            onCropped?.(croppedFile)
          }}
          onCancel={closeCrop}
        />
      )}

      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={handleTap}
          className="block w-14 h-14 rounded-lg overflow-hidden bg-gray-200 focus:outline-none active:opacity-75"
          title="Tap to crop or rotate"
        >
          {thumbSrc ? (
            <img src={thumbSrc} alt={label} className="w-full h-full object-cover" />
          ) : (
            <span className="flex w-full h-full items-center justify-center text-gray-400 text-lg">🖼</span>
          )}
        </button>

        {/* Crop / converting badge */}
        {!reuploading && (
          <span
            className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] leading-none px-1 py-0.5 pointer-events-none select-none"
            style={{ borderBottomLeftRadius: '8px', borderTopRightRadius: '6px' }}
          >
            {converting ? '…' : '✂'}
          </span>
        )}

        {/* Spinner overlay when re-uploading or converting */}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg pointer-events-none">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin block" />
          </span>
        )}

        {/* Remove button */}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center leading-none shadow"
          >
            ×
          </button>
        )}
      </div>
    </>
  )
}
