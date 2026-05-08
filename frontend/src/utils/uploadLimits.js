export const DEFAULT_MAX_UPLOAD_BYTES = Number(import.meta.env.VITE_MAX_UPLOAD_BYTES || 8000000)

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(bytes % 1_000_000 === 0 ? 0 : 1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

export function getUploadSizeError(files, { maxBytes = DEFAULT_MAX_UPLOAD_BYTES, maxTotalBytes = null } = {}) {
  const fileArray = Array.from(files || [])
  const oversized = fileArray.find((file) => file.size > maxBytes)
  if (oversized) {
    return `${oversized.name} is ${formatBytes(oversized.size)}. Maximum per file is ${formatBytes(maxBytes)}.`
  }

  if (maxTotalBytes != null) {
    const total = fileArray.reduce((sum, file) => sum + file.size, 0)
    if (total > maxTotalBytes) {
      return `Selected files total ${formatBytes(total)}. Maximum total is ${formatBytes(maxTotalBytes)}.`
    }
  }

  return null
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

function scaledCanvas(sourceCanvas, scale) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale))
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function canvasToUploadFile(
  sourceCanvas,
  filename = 'upload.jpg',
  { maxBytes = DEFAULT_MAX_UPLOAD_BYTES, maxSide = 1800 } = {},
) {
  const largestSide = Math.max(sourceCanvas.width, sourceCanvas.height)
  let workingCanvas = largestSide > maxSide ? scaledCanvas(sourceCanvas, maxSide / largestSide) : sourceCanvas

  for (const quality of [0.88, 0.82, 0.76, 0.7, 0.64]) {
    const blob = await canvasToBlob(workingCanvas, quality)
    if (blob && blob.size <= maxBytes) {
      return new File([blob], filename.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
    }
  }

  for (let i = 0; i < 3; i += 1) {
    const blob = await canvasToBlob(workingCanvas, 0.62)
    if (blob && blob.size <= maxBytes) {
      return new File([blob], filename.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
    }
    if (!blob) break
    const scale = Math.max(0.55, Math.sqrt(maxBytes / blob.size) * 0.9)
    workingCanvas = scaledCanvas(workingCanvas, scale)
  }

  const finalBlob = await canvasToBlob(workingCanvas, 0.58)
  if (!finalBlob) throw new Error('Could not compress image. Please try a smaller image.')
  if (finalBlob.size > maxBytes) {
    throw new Error(`Image is still larger than ${formatBytes(maxBytes)} after compression.`)
  }
  return new File([finalBlob], filename.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
}
