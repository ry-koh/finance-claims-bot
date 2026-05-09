import { useRef, useState } from 'react'
import ImageCropModal from './ImageCropModal'
import { pdfToImageFiles, isPdfFile } from '../utils/pdfToImages'
import { DEFAULT_MAX_UPLOAD_BYTES, formatBytes, getUploadSizeError } from '../utils/uploadLimits'

export default function DragDropZone({
  label = 'Drop file here',
  onFile,
  onFiles,
  accept = 'image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf',
  imageAccept = 'image/*',
  fileAccept = 'application/pdf',
  multiple = false,
  loading = false,
  compact = false,
  dragBorder = 'border-blue-400 bg-blue-50',
  idleBorder = 'border-gray-300 bg-gray-50 hover:bg-gray-100',
  withCrop = false,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
  maxTotalBytes = null,
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [cropQueue, setCropQueue] = useState([])
  const [converting, setConverting] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const cropResultsRef = useRef([])
  const cropTotalRef = useRef(0)
  const fileRef = useRef(null)
  const attachmentRef = useRef(null)

  const hasImagePicker = accept.includes('image')
  const hasSeparateFilePicker = accept.includes('application/pdf')
  const primaryAccept = hasImagePicker ? imageAccept : accept

  async function dispatch(files) {
    if (!files?.length) return
    const fileArray = Array.from(files)
    const sizeError = getUploadSizeError(fileArray, { maxBytes, maxTotalBytes })
    if (sizeError) {
      setUploadError(sizeError)
      return
    }
    setUploadError(null)

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
    const sizeError = getUploadSizeError(allConfirmed, { maxBytes, maxTotalBytes })
    if (sizeError) {
      cropResultsRef.current = []
      setCropQueue([])
      setUploadError(sizeError)
      return
    }
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
        <p className="text-xs text-gray-400 mt-0.5">
          {hasSeparateFilePicker ? 'Drag & drop or tap to choose photos' : 'Drag & drop or tap to browse'}
        </p>
        <p className="text-[10px] text-gray-400 mt-1 leading-tight">
          Max {formatBytes(maxTotalBytes ?? maxBytes)}{maxTotalBytes ? ' total' : ' per file'}
        </p>
        {withCrop && (
          <p className="text-[10px] text-gray-400 mt-1 leading-tight">
            Crop photo/PDF pages to the receipt or transaction only.
          </p>
        )}
      </div>
      {hasSeparateFilePicker && (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            attachmentRef.current?.click()
          }}
          className="mt-1 text-xs font-medium text-blue-600 underline-offset-2 active:underline disabled:text-gray-400"
        >
          Upload PDF instead
        </button>
      )}
      {uploadError && (
        <p className="mt-1 text-xs text-red-500">{uploadError}</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={primaryAccept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { dispatch(e.target.files); e.target.value = '' }}
      />
      {hasSeparateFilePicker && (
        <input
          ref={attachmentRef}
          type="file"
          accept={fileAccept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => { dispatch(e.target.files); e.target.value = '' }}
        />
      )}
    </>
  )
}
