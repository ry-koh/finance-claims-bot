import { processPdfPages, processReceiptImage } from '../api/receipts'

/**
 * Convert a PDF File into one or more image Files (one per page).
 * Falls back to single-page conversion if the multi-page endpoint fails.
 */
export async function pdfToImageFiles(file) {
  try {
    const data = await processPdfPages(file)
    return data.pages.map((p, i) => {
      const mimeType = p.content_type || 'image/jpeg'
      const ext = mimeType === 'image/png' ? '.png' : '.jpg'
      const baseName = file.name.replace(/\.pdf$/i, '')
      const byteStr = atob(p.data)
      const arr = new Uint8Array(byteStr.length)
      for (let i2 = 0; i2 < byteStr.length; i2++) arr[i2] = byteStr.charCodeAt(i2)
      return new File([arr], `${baseName}_p${i + 1}${ext}`, { type: mimeType })
    })
  } catch {
    // Fallback: single page via process-image
    const data = await processReceiptImage(file)
    const mimeType = data.content_type || 'image/jpeg'
    const ext = mimeType === 'image/png' ? '.png' : '.jpg'
    const byteStr = atob(data.processed_image)
    const arr = new Uint8Array(byteStr.length)
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
    return [new File([arr], file.name.replace(/\.pdf$/i, ext), { type: mimeType })]
  }
}

export function isPdfFile(file) {
  return file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf')
}
