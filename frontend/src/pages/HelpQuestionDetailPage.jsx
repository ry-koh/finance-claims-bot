import { useParams } from 'react-router-dom'
import { useQuestion } from '../api/help'

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

export default function HelpQuestionDetailPage() {
  const { id } = useParams()
  const { data: question, isLoading, error } = useQuestion(id)

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }
  if (error || !question) {
    return <div className="p-4 text-sm text-red-600">Failed to load question.</div>
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
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

      <div>
        <p className="text-sm font-semibold text-gray-700 mb-3">
          {question.answers?.length > 0 ? 'Replies' : 'No replies yet'}
        </p>
        {question.answers?.map((a) => (
          <div key={a.id} className="bg-blue-50 rounded-xl p-4 mb-3">
            <p className="text-[11px] font-semibold text-blue-600 mb-1">{a.answerer_name}</p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{a.answer_text}</p>
            <p className="text-xs text-gray-400">{formatDate(a.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
