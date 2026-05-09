import { useRef, useState } from 'react'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'
import { useProcessReceiptImage, useUploadReceiptImage } from '../api/receipts'
import { DEFAULT_MAX_UPLOAD_BYTES, canvasToUploadFile, formatBytes, getUploadSizeError } from '../utils/uploadLimits'

// State machine values
const STATE_IDLE = 'idle'
const STATE_PROCESSING = 'processing'
const STATE_CROP = 'crop'


export default function ReceiptUploader({
  claimId,
  imageType = 'receipt',
  label = 'Receipt Image',
  onUploaded,
  onClear,
  existingDriveId,
}) {
  const [uiState, setUiState] = useState(STATE_IDLE)
  const [processedImage, setProcessedImage] = useState(null)
  const [processError, setProcessError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [cropperInstance, setCropperInstance] = useState(null)
  const fileInputRef = useRef(null)
  const pdfInputRef = useRef(null)

  const processImageMutation = useProcessReceiptImage()
  const uploadImageMutation = useUploadReceiptImage()

  // ── State 1: Idle ────────────────────────────────────────────────────────────

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    startProcessing(file)
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) startProcessing(file)
  }

  // ── State 2: Processing ──────────────────────────────────────────────────────

  function startProcessing(file) {
    setProcessError(null)
    const sizeError = getUploadSizeError([file], { maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    if (sizeError) {
      setProcessError(sizeError)
      setUiState(STATE_IDLE)
      return
    }
    setUiState(STATE_PROCESSING)
    processImageMutation.mutate(file, {
      onSuccess(data) {
        const { processed_image, content_type } = data
        const mimeType = content_type || 'image/jpeg'
        setProcessedImage(`data:${mimeType};base64,${processed_image}`)
        setUiState(STATE_CROP)
      },
      onError(err) {
        setProcessError(
          err?.response?.data?.detail ||
            err?.message ||
            'Failed to process image. Please try again.'
        )
        setUiState(STATE_IDLE)
      },
    })
  }

  function handleRetry() {
    fileInputRef.current?.click()
  }

  // ── State 3: Crop ────────────────────────────────────────────────────────────

  function handleRotateLeft() {
    cropperInstance?.rotate(-90)
  }

  function handleRotateRight() {
    cropperInstance?.rotate(90)
  }

  function handleCancel() {
    setProcessedImage(null)
    setUiState(STATE_IDLE)
    uploadImageMutation.reset()
  }

  function handleConfirm() {
    if (uploadImageMutation.isPending) return
    const cropper = cropperInstance
    if (!cropper) return

    canvasToUploadFile(cropper.getCroppedCanvas(), 'cropped.jpg')
      .then((file) => {
        uploadImageMutation.mutate(
          { file, claim_id: claimId, image_type: imageType },
          {
            onSuccess(data) {
              setProcessedImage(null)
              setUiState(STATE_IDLE)
              onUploaded?.(data.drive_file_id)
            },
            onError(err) {
              console.error('Upload failed', err)
            },
          }
        )
      })
      .catch((err) => {
        setProcessError(err?.message || 'Could not prepare image for upload.')
        setUiState(STATE_IDLE)
      })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (uiState === STATE_PROCESSING) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-600">Processing image...</p>
      </div>
    )
  }

  if (uiState === STATE_CROP && processedImage) {
    const isUploading = uploadImageMutation.isPending
    const uploadError = uploadImageMutation.error

    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-600">{label}</p>

        <p className="text-xs text-gray-400">Check orientation and crop to remove excess whitespace.</p>

        <Cropper
          src={processedImage}
          onInitialized={(instance) => setCropperInstance(instance)}
          aspectRatio={NaN}
          viewMode={1}
          autoCropArea={1}
          responsive
          style={{ maxHeight: '65vh', width: '100%' }}
        />

        {/* Controls row */}
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={handleRotateLeft}
            disabled={isUploading}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-50"
          >
            ↺ Left
          </button>
          <button
            type="button"
            onClick={handleRotateRight}
            disabled={isUploading}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-50"
          >
            ↻ Right
          </button>
          <button
            type="button"
            onClick={() => cropperInstance?.reset()}
            disabled={isUploading}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-50"
          >
            ↩ Reset
          </button>
        </div>

        {uploadError && (
          <p className="text-xs text-red-500 text-center">
            {uploadError?.response?.data?.detail ||
              uploadError?.message ||
              'Upload failed. Please try again.'}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isUploading}
            className="flex-1 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isUploading}
            className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    )
  }

  // Idle state
  return (
    <div className="flex flex-col gap-1">
      {existingDriveId ? (
        <div className="flex items-center justify-between px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-sm text-green-700 font-medium">{label} — Uploaded ✓</span>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-red-500 underline ml-2"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-xl py-5 px-3 text-center cursor-pointer transition-colors select-none ${
              isDragging
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:bg-gray-100 active:bg-gray-200'
            }`}
          >
            <p className="text-2xl mb-1">{isDragging ? '📂' : '🖼️'}</p>
            <p className="text-sm font-medium text-gray-700">
              {isDragging ? 'Drop to upload' : `Upload ${label}`}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Drag & drop or tap to choose photos</p>
            <p className="text-[10px] text-gray-400 mt-1">Max {formatBytes(DEFAULT_MAX_UPLOAD_BYTES)} per file</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-tight">
              Crop photo/PDF pages to the receipt or transaction only.
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              pdfInputRef.current?.click()
            }}
            className="mt-1 text-xs font-medium text-blue-600 underline-offset-2 active:underline"
          >
            Upload PDF instead
          </button>
          {processError && (
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-xs text-red-500">{processError}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs text-blue-600 underline self-start"
              >
                Retry
              </button>
            </div>
          )}
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
