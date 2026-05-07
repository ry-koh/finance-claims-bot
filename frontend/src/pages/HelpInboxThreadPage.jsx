import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuestion, usePostAnswer } from '../api/help'

function imageUrl(path) {
  return `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(path)}`
}

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d)
    ? str
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

export default function HelpInboxThreadPage() {
  const { id } = useParams()
  const { data: question, isLoading } = useQuestion(id)
  const [answerText, setAnswerText] = useState('')
  const postAnswer = usePostAnswer(id)

  function handleSend() {
    if (!answerText.trim()) return
    postAnswer.mutate(
      { answer_text: answerText.trim() },
      { onSuccess: () => setAnswerText('') }
    )
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }
  if (!question) {
    return <div className="p-4 text-sm text-red-600">Question not found.</div>
  }

  return (
    <div className="p-4 pb-4 max-w-lg mx-auto space-y-4">
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-sm text-gray-900 whitespace-pre-wrap mb-3">{question.question_text}</p>
        {question.image_urls?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {question.image_urls.map((url, i) => (
              <img
                key={i}
                src={imageUrl(url)}
                alt="Attachment"
                className="w-20 h-20 object-cover rounded-lg active:opacity-80"
                onClick={() => window.open(imageUrl(url))}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400">{formatDate(question.created_at)}</p>
      </div>

      {question.answers?.length > 0 && (
        <div className="space-y-3">
          {question.answers.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-[11px] font-semibold text-blue-600 mb-1">{a.answerer_name}</p>
              <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{a.answer_text}</p>
              <p className="text-xs text-gray-400">{formatDate(a.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-gray-100 flex gap-2">
        <textarea
          className="flex-1 border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          placeholder="Type a reply..."
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
        />
        <button
          onClick={handleSend}
          disabled={!answerText.trim() || postAnswer.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl active:bg-blue-700 disabled:opacity-50 self-end"
        >
          {postAnswer.isPending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
