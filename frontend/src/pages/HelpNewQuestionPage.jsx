import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateQuestion, uploadHelpImage } from '../api/help'
import { imageUrl } from '../api/images'

export default function HelpNewQuestionPage() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [images, setImages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const createQuestion = useCreateQuestion()

  async function handleFileChange(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const results = await Promise.all(files.map((f) => uploadHelpImage(f)))
      setImages((prev) => [...prev, ...results.map((r) => r.url)])
    } catch {
      setError('Failed to upload image. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function removeImage(idx) {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleSubmit() {
    if (!text.trim()) return
    setError(null)
    createQuestion.mutate(
      { question_text: text.trim(), image_urls: images },
      {
        onSuccess: () => navigate('/help', { replace: true }),
        onError: (err) =>
          setError(err?.response?.data?.detail || 'Failed to submit. Please try again.'),
      }
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Your question
        </label>
        <textarea
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={5}
          placeholder="Describe your question..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((url, idx) => (
            <div key={idx} className="relative w-20 h-20">
              <img
                src={imageUrl(url)}
                alt="Attachment"
                className="w-20 h-20 object-cover rounded-lg"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 text-white rounded-full text-xs flex items-center justify-center leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-sm text-blue-600 font-medium active:opacity-70 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : '+ Attach images'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!text.trim() || createQuestion.isPending}
        className="w-full bg-blue-600 text-white text-sm font-semibold py-3 rounded-xl active:bg-blue-700 disabled:opacity-50"
      >
        {createQuestion.isPending ? 'Submitting...' : 'Submit question'}
      </button>
    </div>
  )
}
