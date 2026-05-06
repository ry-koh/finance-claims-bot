import { useEffect, useMemo, useRef } from 'react'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'

export default function ImageCropModal({ file, fileNumber, fileTotal, onConfirm, onCancel }) {
  const cropperRef = useRef(null)
  const src = useMemo(() => URL.createObjectURL(file), [file])

  useEffect(() => {
    return () => URL.revokeObjectURL(src)
  }, [src])

  function rotate(deg) {
    cropperRef.current?.cropper.rotate(deg)
  }

  function confirm() {
    const canvas = cropperRef.current?.cropper.getCroppedCanvas()
    if (!canvas) return
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const croppedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
          type: 'image/jpeg',
        })
        onConfirm(croppedFile)
      },
      'image/jpeg',
      0.92
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="bg-white rounded-t-2xl w-full shadow-xl flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-gray-800 text-sm">
            Crop & Rotate
            {fileTotal > 1 && (
              <span className="ml-2 text-xs text-gray-400 font-normal">
                {fileNumber} of {fileTotal}
              </span>
            )}
          </h3>
          <button type="button" onClick={onCancel} className="text-gray-400 text-xl leading-none p-1">
            ✕
          </button>
        </div>

        <div className="bg-black flex-shrink-0" style={{ height: '55vh' }}>
          <Cropper
            ref={cropperRef}
            src={src}
            style={{ height: '55vh', width: '100%' }}
            viewMode={1}
            dragMode="move"
            autoCropArea={0.95}
            responsive
            guides
            center={false}
            highlight={false}
            cropBoxMovable
            cropBoxResizable
            toggleDragModeOnDblclick={false}
          />
        </div>

        <div className="px-3 py-3 flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => rotate(-90)}
              className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg text-gray-700"
            >
              ↺ Left
            </button>
            <button
              type="button"
              onClick={() => rotate(90)}
              className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg text-gray-700"
            >
              ↻ Right
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg font-medium"
            >
              {fileNumber < fileTotal ? 'Next →' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
