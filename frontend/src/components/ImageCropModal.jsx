import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'

// Header ~52px + footer ~80px
const CHROME_HEIGHT = 132

/**
 * Full-screen crop/rotate modal.
 * Accepts either:
 *   file  — File object  (component creates + revokes an object URL)
 *   src   — URL string   (used directly as Cropper src)
 */
export default function ImageCropModal({ file, src: srcProp, fileNumber, fileTotal, onConfirm, onCancel }) {
  const [src, setSrc] = useState(null)
  const [cropperInstance, setCropperInstance] = useState(null)

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setSrc(url)
      return () => URL.revokeObjectURL(url)
    } else if (srcProp) {
      setSrc(srcProp)
    }
  }, [file, srcProp])

  function rotate(deg) {
    if (!cropperInstance) return
    cropperInstance.rotate(deg)

    // After rotation the canvas may overflow the container (portrait→landscape or vice versa).
    // Re-fit it so the whole image stays visible without zooming in.
    requestAnimationFrame(() => {
      if (!cropperInstance) return
      const container = cropperInstance.getContainerData()
      const canvas = cropperInstance.getCanvasData()

      const fit = Math.min(container.width / canvas.width, container.height / canvas.height)
      const newW = Math.floor(canvas.width * fit)
      const newH = Math.floor(canvas.height * fit)
      const newLeft = Math.floor((container.width - newW) / 2)
      const newTop = Math.floor((container.height - newH) / 2)

      cropperInstance.setCanvasData({ left: newLeft, top: newTop, width: newW, height: newH })
      // Expand crop box to fill the newly fitted canvas
      cropperInstance.setCropBoxData({ left: newLeft, top: newTop, width: newW, height: newH })
    })
  }

  function confirm() {
    const canvas = cropperInstance?.getCroppedCanvas()
    if (!canvas) return
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const name = file?.name.replace(/\.[^.]+$/, '.jpg') ?? 'cropped.jpg'
        onConfirm(new File([blob], name, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92
    )
  }

  const isLast = fileNumber >= fileTotal

  if (!src) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-white/70 text-sm font-medium px-1 py-1 active:text-white"
        >
          Cancel
        </button>

        <div className="text-center">
          <p className="text-white text-sm font-semibold">Crop & Rotate</p>
          {fileTotal > 1 && (
            <div className="flex justify-center gap-1.5 mt-1">
              {Array.from({ length: fileTotal }).map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < fileNumber ? 'bg-white' : 'bg-white/25'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="w-14" />
      </div>

      {/* Cropper — touch-action:none stops the browser hijacking swipe/pinch gestures */}
      <div style={{ height: `calc(100vh - ${CHROME_HEIGHT}px)`, touchAction: 'none' }}>
        <Cropper
          src={src}
          style={{ height: '100%', width: '100%' }}
          onInitialized={(instance) => setCropperInstance(instance)}
          viewMode={1}
          dragMode="move"
          autoCropArea={1}
          responsive
          guides
          center={false}
          highlight={false}
          cropBoxMovable
          cropBoxResizable
          toggleDragModeOnDblclick={false}
          zoomOnTouch
          zoomOnWheel={false}
          minCropBoxWidth={20}
          minCropBoxHeight={20}
        />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => rotate(-90)}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors"
          >
            <span className="text-white text-2xl leading-none select-none">↺</span>
          </button>
          <button
            type="button"
            onClick={() => rotate(90)}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors"
          >
            <span className="text-white text-2xl leading-none select-none">↻</span>
          </button>
          <button
            type="button"
            onClick={() => cropperInstance?.reset()}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors"
            title="Reset"
          >
            {/* Reset icon */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-white">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={confirm}
          className="px-6 py-2.5 bg-white text-black rounded-full font-semibold text-sm active:bg-white/80 transition-colors"
        >
          {isLast ? 'Use Photo' : 'Next →'}
        </button>
      </div>
    </div>,
    document.body
  )
}
