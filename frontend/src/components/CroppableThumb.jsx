import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ImageCropModal from './ImageCropModal'
import { pdfToImageFiles, isPdfFile } from '../utils/pdfToImages'

/**
 * Square thumbnail with tap-to-recrop.
 *
 *   file             — File object (in-memory, not yet uploaded)
 *   src              — URL string (already uploaded image)
 *   onRemove()       — called when × is tapped
 *   onCropped(file)  — called with a single cropped file (single-page / stored-URL flow)
 *   onCroppedMany(files[]) — called instead of onCropped when a PDF expands to >1 page;
 *                            receives all confirmed pages as an array so callers can
 *                            insert them all (rather than overwriting a single slot).
 *                            Falls back to onCropped(files[0]) if not provided.
 *   reuploading      — shows spinner overlay while parent is re-uploading
 */
export default function CroppableThumb({ file, src, label = 'image', onRemove, onCropped, onCroppedMany, reuploading = false }) {
  const [thumbSrc, setThumbSrc] = useState(null)
  const [cropQueue, setCropQueue] = useState([])  // File[] — pages waiting to crop
  const [cropSrc, setCropSrc] = useState(null)    // URL — for non-PDF uploaded images
  const [converting, setConverting] = useState(false)
  const pendingConfirmsRef = useRef(0)            // total pages queued
  const confirmedPagesRef = useRef([])            // accumulates cropped pages until queue clears

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setThumbSrc(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setThumbSrc(src || null)
    }
  }, [file, src])

  async function handleTap() {
    if (reuploading || converting) return

    if (file) {
      if (isPdfFile(file)) {
        setConverting(true)
        try {
          const pages = await pdfToImageFiles(file)
          pendingConfirmsRef.current = pages.length
          confirmedPagesRef.current = []
          setCropQueue(pages)
        } catch (err) {
          // Conversion failed — skip crop and send the raw PDF straight to the caller;
          // the backend upload endpoint converts PDFs to JPEG on its own.
          console.error('PDF conversion failed, bypassing crop:', err)
          onCropped?.(file)
        } finally {
          setConverting(false)
        }
      } else {
        pendingConfirmsRef.current = 1
        confirmedPagesRef.current = []
        setCropQueue([file])
      }
    } else if (src) {
      // Stored images are always JPEG (backend converts on upload), so pass URL directly
      setCropSrc(src)
    }
  }

  function handleCropConfirm(croppedFile) {
    const allConfirmed = [...confirmedPagesRef.current, croppedFile]
    confirmedPagesRef.current = allConfirmed
    setCropQueue((prev) => {
      const remaining = prev.slice(1)
      if (remaining.length === 0) {
        confirmedPagesRef.current = []
        if (allConfirmed.length > 1 && onCroppedMany) {
          onCroppedMany(allConfirmed)
        } else {
          // Single page or no onCroppedMany — emit each page individually
          allConfirmed.forEach((f) => onCropped?.(f))
        }
      }
      return remaining
    })
  }

  function handleCropCancel() {
    confirmedPagesRef.current = []
    setCropQueue([])
    setCropSrc(null)
  }

  const showModal = cropQueue.length > 0 || !!cropSrc
  const queueTotal = pendingConfirmsRef.current
  const queueDone = queueTotal - cropQueue.length
  const busy = reuploading || converting

  return (
    <>
      {showModal && createPortal(
        <ImageCropModal
          file={cropQueue[0] || undefined}
          src={cropSrc || undefined}
          fileNumber={cropSrc ? 1 : queueDone + 1}
          fileTotal={cropSrc ? 1 : queueTotal}
          onConfirm={cropSrc ? (f) => { setCropSrc(null); onCropped?.(f) } : handleCropConfirm}
          onCancel={handleCropCancel}
        />,
        document.body
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

        {/* Badge */}
        {!reuploading && (
          <span
            className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] leading-none px-1 py-0.5 pointer-events-none select-none"
            style={{ borderBottomLeftRadius: '8px', borderTopRightRadius: '6px' }}
          >
            {converting ? '…' : '✂'}
          </span>
        )}

        {/* Spinner */}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg pointer-events-none">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin block" />
          </span>
        )}

        {/* Remove */}
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
