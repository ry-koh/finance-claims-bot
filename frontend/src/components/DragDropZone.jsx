import { useRef, useState } from 'react'
import ImageCropModal from './ImageCropModal'
import { processReceiptImage } from '../api/receipts'

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
  const [converting, setConverting] = useState(false)
  const cropResultsRef = useRef([])
  const fileRef = useRef(null)

  async function toImageFile(file) {
    if (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) {
      const data = await processReceiptImage(file)
      const mimeType = data.content_type || 'image/jpeg'
      const byteStr = atob(data.processed_image)
      const arr = new Uint8Array(byteStr.length)
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
      const ext = mimeType === 'image/png' ? '.png' : '.jpg'
      return new File([arr], file.name.replace(/\.pdf$/i, ext), { type: mimeType })
    }
    return file
  }

  async function dispatch(files) {
    if (!files?.length) return
    const fileArray = Array.from(files)
    if (!withCrop) {
      if (multiple && onFiles) onFiles(fileArray)
      else if (onFile) onFile(fileArray[0])
      return
    }

    setConverting(true)
    try {
      const converted = await Promise.all(fileArray.map(toImageFile))
      cropResultsRef.current = []
      setCropQueue(converted)
    } catch {
      // If conversion fails, pass through as-is
      if (multiple && onFiles) onFiles(fileArray)
      else if (onFile) onFile(fileArray[0])
    } finally {
      setConverting(false)
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

  const busy = loading || converting

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
        onClick={() => !busy && fileRef.current?.click()}
        className={[
          'w-full border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors select-none',
          compact ? 'py-2 px-2' : 'py-4 px-3',
          isDragging ? dragBorder : idleBorder,
          busy ? 'opacity-50 cursor-not-allowed' : '',
        ].filter(Boolean).join(' ')}
      >
        <p className={`font-medium ${compact ? 'text-xs' : 'text-sm'} text-gray-700`}>
          {converting ? 'Converting…' : busy ? 'Uploading…' : isDragging ? 'Drop to upload' : label}
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
