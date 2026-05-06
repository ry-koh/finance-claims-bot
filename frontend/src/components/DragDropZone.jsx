import { useRef, useState } from 'react'
import ImageCropModal from './ImageCropModal'
import { pdfToImageFiles, isPdfFile } from '../utils/pdfToImages'

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
  const cropTotalRef = useRef(0)
  const fileRef = useRef(null)

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
      // Expand PDFs into one File per page; keep non-PDFs as-is
      const expanded = (
        await Promise.all(fileArray.map((f) => isPdfFile(f) ? pdfToImageFiles(f) : Promise.resolve([f])))
      ).flat()
      cropResultsRef.current = []
      cropTotalRef.current = expanded.length
      setCropQueue(expanded)
    } catch {
      if (multiple && onFiles) onFiles(fileArray)
      else if (onFile) onFile(fileArray[0])
    } finally {
      setConverting(false)
    }
  }

  function handleCropConfirm(croppedFile) {
    const allConfirmed = [...cropResultsRef.current, croppedFile]
    cropResultsRef.current = allConfirmed
    // Advance queue — side effects outside the updater to avoid Strict Mode double-invoke
    setCropQueue((prev) => prev.slice(1))
    if (allConfirmed.length === cropTotalRef.current) {
      cropResultsRef.current = []
      if (multiple && onFiles) onFiles(allConfirmed)
      else if (onFile) onFile(allConfirmed[0])
    }
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
          key={cropTotalRef.current - cropQueue.length}
          file={cropQueue[0]}
          fileNumber={cropTotalRef.current - cropQueue.length + 1}
          fileTotal={cropTotalRef.current}
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
