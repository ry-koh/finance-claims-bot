import { useNavigate } from 'react-router-dom'
import { useAllQuestions } from '../api/help'

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function HelpInboxPage() {
  const navigate = useNavigate()
  const { data: questions = [], isLoading } = useAllQuestions()

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      {questions.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No questions yet</p>
      )}
      {questions.map((q) => (
        <div
          key={q.id}
          onClick={() => navigate(`/help-inbox/${q.id}`)}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3 active:bg-gray-50"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-gray-700">
                {q.asker_name}
                {q.asker_cca ? (
                  <span className="font-normal text-gray-400"> · {q.asker_cca}</span>
                ) : null}
              </p>
              <p className="text-sm text-gray-900 line-clamp-2 mt-0.5">{q.question_text}</p>
            </div>
            <span
              className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                q.status === 'answered'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {q.status === 'answered' ? 'Answered' : 'Open'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-gray-400">{formatDate(q.created_at)}</p>
            {q.answer_count > 0 && (
              <p className="text-xs text-gray-400">
                {q.answer_count} {q.answer_count === 1 ? 'reply' : 'replies'}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
