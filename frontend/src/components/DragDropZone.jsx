import { useRef, useState } from 'react'
import ImageCropModal from './ImageCropModal'

export default function DragDropZone({
  label = 'Drop file here',
  onFile,
  onFiles,
  accept = 'image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf',
  multiple = false,
  loading = false,
  compact = false,
  dragBorder = 'border-blue-400 bg-blue-50',
  idleBorder = 'border-gray-300 bg-gray-50 hover:bg-gray-100',
  withCrop = false,
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [cropQueue, setCropQueue] = useState([])
  const cropResultsRef = useRef([])
  const fileRef = useRef(null)

  function dispatch(files) {
    if (!files?.length) return
    const fileArray = Array.from(files)
    if (withCrop) {
      const croppable = fileArray.filter((f) => f.type.startsWith('image/'))
      if (croppable.length === 0) {
        // No images (e.g. PDF), pass through directly
        if (multiple && onFiles) onFiles(fileArray)
        else if (onFile) onFile(fileArray[0])
        return
      }
      cropResultsRef.current = []
      setCropQueue(croppable)
    } else {
      if (multiple && onFiles) onFiles(fileArray)
      else if (onFile) onFile(fileArray[0])
    }
  }

  function handleCropConfirm(croppedFile) {
    cropResultsRef.current = [...cropResultsRef.current, croppedFile]
    setCropQueue((prev) => {
      const remaining = prev.slice(1)
      if (remaining.length === 0) {
        const results = cropResultsRef.current
        cropResultsRef.current = []
        if (multiple && onFiles) onFiles(results)
        else if (onFile) onFile(results[0])
      }
      return remaining
    })
  }

  function handleCropCancel() {
    cropResultsRef.current = []
    setCropQueue([])
  }

  return (
    <>
      {withCrop && cropQueue.length > 0 && (
        <ImageCropModal
          file={cropQueue[0]}
          fileNumber={cropResultsRef.current.length + 1}
          fileTotal={cropResultsRef.current.length + cropQueue.length}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); dispatch(e.dataTransfer.files) }}
        onClick={() => !loading && fileRef.current?.click()}
        className={[
          'w-full border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors select-none',
          compact ? 'py-2 px-2' : 'py-4 px-3',
          isDragging ? dragBorder : idleBorder,
          loading ? 'opacity-50 cursor-not-allowed' : '',
        ].filter(Boolean).join(' ')}
      >
        <p className={`font-medium ${compact ? 'text-xs' : 'text-sm'} text-gray-700`}>
          {loading ? 'Uploading…' : isDragging ? 'Drop to upload' : label}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">Drag & drop or tap to browse</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { dispatch(e.target.files); e.target.value = '' }}
      />
    </>
  )
}
