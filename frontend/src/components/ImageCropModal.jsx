import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'
import { canvasToUploadFile } from '../utils/uploadLimits'

// Header ~52px + footer ~80px
const CHROME_HEIGHT = 132

/**
 * Full-screen crop/rotate modal.
 * Accepts either:
 *   file  — File object  (component creates + revokes an object URL)
 *   src   — URL string   (used directly as Cropper src)
 *
 * Rotation is applied by drawing the current image onto an offscreen canvas
 * and remounting Cropper with the result, so the image always fits the
 * container after rotation without Cropper.js zooming in.
 */
export default function ImageCropModal({ file, src: srcProp, fileNumber, fileTotal, onConfirm, onCancel }) {
  const [displaySrc, setDisplaySrc] = useState(null)
  const [cropperInstance, setCropperInstance] = useState(null)
  const [cropperKey, setCropperKey] = useState(0)
  const [rotating, setRotating] = useState(false)
  const [compressError, setCompressError] = useState(null)

  // Track the latest rotated blob URL so we can revoke it on the next rotation
  const rotatedUrlRef = useRef(null)

  // Set up the initial source from file or URL prop
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setDisplaySrc(url)
      setCropperKey((k) => k + 1)
      return () => {
        URL.revokeObjectURL(url)
      }
    } else if (srcProp) {
      setDisplaySrc(srcProp)
      setCropperKey((k) => k + 1)
    }
  }, [file, srcProp])

  // Revoke any leftover rotated URL on unmount
  useEffect(() => {
    return () => {
      if (rotatedUrlRef.current) {
        URL.revokeObjectURL(rotatedUrlRef.current)
        rotatedUrlRef.current = null
      }
    }
  }, [])

  async function rotate(deg) {
    if (!displaySrc || rotating) return
    setRotating(true)

    try {
      // Draw the current displayed image onto an offscreen canvas, rotated by `deg`
      const img = new Image()
      // crossOrigin needed when drawing URL-based images onto canvas
      if (!file) img.crossOrigin = 'anonymous'
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = displaySrc
      })

      const rad = (deg * Math.PI) / 180
      const transposed = Math.abs(deg) % 180 === 90
      const w = transposed ? img.naturalHeight : img.naturalWidth
      const h = transposed ? img.naturalWidth : img.naturalHeight

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.translate(w / 2, h / 2)
      ctx.rotate(rad)
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95))
      const newUrl = URL.createObjectURL(blob)

      // Revoke the previous rotated URL (the original file URL is managed by its own useEffect)
      if (rotatedUrlRef.current) {
        URL.revokeObjectURL(rotatedUrlRef.current)
      }
      rotatedUrlRef.current = newUrl

      setDisplaySrc(newUrl)
      setCropperKey((k) => k + 1) // remount Cropper so it fits the new image cleanly
    } catch (err) {
      // CORS or canvas failure (e.g. tainted image) — fall back to Cropper.js internal rotation
      console.warn('Canvas rotation failed, using Cropper.js fallback:', err)
      cropperInstance?.rotate(deg)
    } finally {
      setRotating(false)
    }
  }

  async function confirm() {
    const canvas = cropperInstance?.getCroppedCanvas()
    if (!canvas) return
    const name = file?.name.replace(/\.[^.]+$/, '.jpg') ?? 'cropped.jpg'
    try {
      setCompressError(null)
      const uploadFile = await canvasToUploadFile(canvas, name)
      onConfirm(uploadFile)
    } catch (err) {
      setCompressError(err?.message || 'Could not prepare image for upload.')
    }
  }

  const isLast = fileNumber >= fileTotal

  if (!displaySrc) return null

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

      {/* Cropper — touch-action:none stops the browser hijacking swipe/pinch */}
      <div style={{ height: `calc(100vh - ${CHROME_HEIGHT}px)`, touchAction: 'none' }}>
        <Cropper
          key={cropperKey}
          src={displaySrc}
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
            disabled={rotating}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors disabled:opacity-40"
          >
            <span className="text-white text-2xl leading-none select-none">↺</span>
          </button>
          <button
            type="button"
            onClick={() => rotate(90)}
            disabled={rotating}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors disabled:opacity-40"
          >
            <span className="text-white text-2xl leading-none select-none">↻</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (rotatedUrlRef.current) {
                URL.revokeObjectURL(rotatedUrlRef.current)
                rotatedUrlRef.current = null
              }
              if (file) {
                const resetUrl = URL.createObjectURL(file)
                rotatedUrlRef.current = resetUrl
                setDisplaySrc(resetUrl)
              } else {
                setDisplaySrc(srcProp)
              }
              setCropperKey((k) => k + 1)
            }}
            disabled={rotating}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors disabled:opacity-40"
            title="Reset"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-white">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={rotating || !cropperInstance}
          className="px-6 py-2.5 bg-white text-black rounded-full font-semibold text-sm active:bg-white/80 transition-colors disabled:opacity-50"
        >
          {isLast ? 'Use Photo' : 'Next →'}
        </button>
      </div>
      {compressError && (
        <div className="fixed bottom-20 left-4 right-4 rounded-lg bg-red-600 px-3 py-2 text-center text-xs font-medium text-white">
          {compressError}
        </div>
      )}
    </div>,
    document.body
  )
}
