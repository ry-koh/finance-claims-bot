import { useRef, useState } from 'react'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'
import { useProcessReceiptImage, useUploadReceiptImage } from '../api/receipts'

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
  const [processedImage, setProcessedImage] = useState(null) // base64 data URL
  const [processError, setProcessError] = useState(null)
  const fileInputRef = useRef(null)
  const cropperRef = useRef(null)

  const processImageMutation = useProcessReceiptImage()
  const uploadImageMutation = useUploadReceiptImage()

  // ── State 1: Idle / already uploaded ────────────────────────────────────────

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset file input so re-selecting the same file triggers onChange again
    e.target.value = ''
    startProcessing(file)
  }

  // ── State 2: Processing ──────────────────────────────────────────────────────

  function startProcessing(file) {
    setProcessError(null)
    setUiState(STATE_PROCESSING)
    processImageMutation.mutate(file, {
      onSuccess(data) {
        const { processed_image, content_type } = data
        const mimeType = content_type || 'image/jpeg'
        const dataUrl = `data:${mimeType};base64,${processed_image}`
        setProcessedImage(dataUrl)
        setUiState(STATE_CROP)
      },
      onError(err) {
        const msg =
          err?.response?.data?.detail ||
          err?.message ||
          'Failed to process image. Please try again.'
        setProcessError(msg)
        setUiState(STATE_IDLE)
      },
    })
  }

  function handleRetry() {
    fileInputRef.current?.click()
  }

  // ── State 3: Crop ────────────────────────────────────────────────────────────

  function handleRotateLeft() {
    cropperRef.current?.cropper.rotate(-90)
  }

  function handleRotateRight() {
    cropperRef.current?.cropper.rotate(90)
  }

  function handleCancel() {
    setProcessedImage(null)
    setUiState(STATE_IDLE)
    uploadImageMutation.reset()
  }

  function handleConfirm() {
    const cropper = cropperRef.current?.cropper
    if (!cropper) return

    cropper.getCroppedCanvas().toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], 'cropped.jpg', { type: 'image/jpeg' })
        uploadImageMutation.mutate(
          { file, claim_id: claimId, image_type: imageType },
          {
            onSuccess(data) {
              setProcessedImage(null)
              setUiState(STATE_IDLE)
              onUploaded?.(data.drive_file_id)
            },
            onError(err) {
              // Error message rendered inline; stay in crop state
              console.error('Upload failed', err)
            },
          }
        )
      },
      'image/jpeg',
      0.92
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  // Processing state
  if (uiState === STATE_PROCESSING) {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-600">Processing image...</p>
      </div>
    )
  }

  // Crop state
  if (uiState === STATE_CROP && processedImage) {
    const isUploading = uploadImageMutation.isPending
    const uploadError = uploadImageMutation.error

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-gray-700">{label}</p>

        <Cropper
          ref={cropperRef}
          src={processedImage}
          aspectRatio={NaN}
          viewMode={1}
          autoCropArea={0.9}
          responsive
          style={{ maxHeight: '60vh', width: '100%' }}
        />

        {/* Rotate controls */}
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={handleRotateLeft}
            disabled={isUploading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-50"
          >
            ↺ Rotate Left
          </button>
          <button
            type="button"
            onClick={handleRotateRight}
            disabled={isUploading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-50"
          >
            ↻ Rotate Right
          </button>
        </div>

        {/* Upload error */}
        {uploadError && (
          <p className="text-xs text-red-500 text-center">
            {uploadError?.response?.data?.detail ||
              uploadError?.message ||
              'Upload failed. Please try again.'}
          </p>
        )}

        {/* Confirm / Cancel */}
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

  // Idle state (with or without existing upload)
  return (
    <div className="flex flex-col gap-1">
      {existingDriveId ? (
        <div className="flex items-center justify-between px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-sm text-green-700 font-medium">
            {label} — Uploaded ✓
          </span>
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 px-3 text-sm bg-gray-100 border border-dashed border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 active:bg-gray-200"
          >
            Upload {label}
          </button>
          {processError && (
            <div className="flex flex-col gap-1">
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
