import WebApp from '@twa-dev/sdk'

export function imageUrl(path) {
  if (!path) return ''
  const params = new URLSearchParams({ path })
  if (WebApp.initData) params.set('init_data', WebApp.initData)
  const baseUrl = import.meta.env.VITE_API_URL || ''
  return `${baseUrl}/images/view?${params.toString()}`
}

export function documentUrl(fileId) {
  if (!fileId) return '#'
  if (!fileId.includes('/')) return `https://drive.google.com/file/d/${fileId}/view`
  return imageUrl(fileId)
}
