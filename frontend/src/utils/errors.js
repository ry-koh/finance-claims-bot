export function friendlyError(err, fallback = 'Action failed. Please try again.') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') {
    if (detail === 'Missing Telegram authentication') {
      return 'Open the app from Telegram so your session can be verified.'
    }
    if (detail === 'Telegram session expired') {
      return 'Your Telegram session expired. Close and reopen the mini app.'
    }
    if (detail.includes('already in progress')) {
      return 'This claim is already processing. Keep the page open and wait for it to finish.'
    }
    if (detail.includes('File is too large') || detail.includes('Combined upload is too large')) {
      return detail
    }
    return detail
  }

  const status = err?.response?.status
  if ([502, 503, 504].includes(status)) {
    return 'The server is waking up or temporarily busy. Please try again in a moment.'
  }
  if (status === 413) return 'The upload is too large. Compress or split the file before trying again.'
  if (status === 401) return 'Your Telegram session could not be verified. Reopen the app from Telegram.'
  if (status === 403) return 'You do not have access to this action.'
  if (status === 409) return 'This item changed or is already being processed. Refresh and try again.'
  if (!err?.response) return 'Could not reach the backend. Check the frontend URL, API URL, and CORS settings.'

  return err?.message || fallback
}
