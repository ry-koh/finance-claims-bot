import { useEffect, useState } from 'react'
import ImageCropModal from './ImageCropModal'

/**
 * Square thumbnail with tap-to-recrop.
 *
 *   file   — File object (in-memory, not yet uploaded)
 *   src    — URL string (already uploaded image)
 *   onRemove()          — called when × is tapped
 *   onCropped(newFile)  — called after crop is confirmed
 *   reuploading         — shows spinner overlay while parent is re-uploading
 */
export default function CroppableThumb({ file, src, label = 'image', onRemove, onCropped, reuploading = false }) {
  const [thumbSrc, setThumbSrc] = useState(null)
  const [showCrop, setShowCrop] = useState(false)

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setThumbSrc(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setThumbSrc(src || null)
    }
  }, [file, src])

  function handleTap() {
    if (reuploading) return
    if (file || src) setShowCrop(true)
  }

  return (
    <>
      {showCrop && (
        <ImageCropModal
          file={file}
          src={src}
          fileNumber={1}
          fileTotal={1}
          onConfirm={(croppedFile) => {
            setShowCrop(false)
            onCropped?.(croppedFile)
          }}
          onCancel={() => setShowCrop(false)}
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

        {/* Crop badge */}
        {!reuploading && (
          <span
            className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] leading-none px-1 py-0.5 pointer-events-none select-none"
            style={{ borderBottomLeftRadius: '8px', borderTopRightRadius: '6px' }}
          >
            ✂
          </span>
        )}

        {/* Spinner overlay when re-uploading */}
        {reuploading && (
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
