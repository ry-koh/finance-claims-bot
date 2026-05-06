import { useEffect, useState } from 'react'
import ImageCropModal from './ImageCropModal'

/**
 * Square thumbnail with tap-to-recrop.
 *
 * Props:
 *   file   — File object (in-memory, not yet uploaded)
 *   src    — URL string (already uploaded; fetched on tap to create a croppable File)
 *   label  — accessible name, also used as filename when fetching
 *   onRemove()          — called when × is tapped
 *   onCropped(newFile)  — called after crop is confirmed; parent handles re-upload / state update
 *   reuploading         — shows spinner overlay while parent is re-uploading
 */
export default function CroppableThumb({ file, src, label = 'image', onRemove, onCropped, reuploading = false }) {
  const [thumbSrc, setThumbSrc] = useState(null)
  const [cropFile, setCropFile] = useState(null)
  const [fetching, setFetching] = useState(false)

  // Build the preview URL — revoke object URLs on cleanup
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
    if (fetching || reuploading) return
    if (file) {
      setCropFile(file)
    } else if (src) {
      setFetching(true)
      try {
        const resp = await fetch(src)
        const blob = await resp.blob()
        const fetched = new File([blob], label.replace(/[^a-z0-9.]/gi, '_') + '.jpg', {
          type: blob.type.startsWith('image/') ? blob.type : 'image/jpeg',
        })
        setCropFile(fetched)
      } catch {
        // silently ignore — user can try again
      } finally {
        setFetching(false)
      }
    }
  }

  const busy = fetching || reuploading

  return (
    <>
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          fileNumber={1}
          fileTotal={1}
          onConfirm={(croppedFile) => {
            setCropFile(null)
            onCropped?.(croppedFile)
          }}
          onCancel={() => setCropFile(null)}
        />
      )}

      <div className="relative flex-shrink-0">
        {/* Thumbnail */}
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

          {/* Spinner when fetching or re-uploading */}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin block" />
            </span>
          )}
        </button>

        {/* Crop badge — bottom-left corner */}
        {!busy && (
          <span
            className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] leading-none px-1 py-0.5 rounded-br-lg rounded-tl-none pointer-events-none select-none"
            style={{ borderTopRightRadius: '6px' }}
          >
            ✂
          </span>
        )}

        {/* Remove button — top-right corner */}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs font-bold flex items-center justify-center leading-none shadow"
          >
            ×
          </button>
        )}
      </div>
    </>
  )
}
