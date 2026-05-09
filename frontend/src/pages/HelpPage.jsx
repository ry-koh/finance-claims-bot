import { useNavigate } from 'react-router-dom'
import { useMyQuestions } from '../api/help'

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const COMMON_QUESTIONS = [
  {
    title: 'Shopee receipts',
    body: 'For Shopee purchases, please upload the official invoice. Screenshots of the completed order page are not accepted as receipts. The official invoice is usually generated only after the item has been delivered, so please wait for delivery before submitting the claim.',
  },
  {
    title: 'Bank transaction screenshots',
    body: 'Bank transaction screenshots must show that the transaction has been completed or posted. Pending transactions are not accepted.',
  },
  {
    title: 'Physical purchase paid by card',
    body: 'If an item was bought physically but the receipt shows Visa, Mastercard, or another card payment method, please upload the matching bank transaction screenshot as well.',
  },
  {
    title: 'Payment methods not accepted',
    body: 'Vouchers, including SG60 vouchers and CDC vouchers, are not accepted for claims. PayLater payment methods are also not accepted.',
  },
]

export default function HelpPage() {
  const navigate = useNavigate()
  const { data: questions = [], isLoading } = useMyQuestions()

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-1">Common Questions</p>
        <p className="text-xs text-gray-500 mb-3">
          Receipt and bank transaction requirements may vary by platform. Check here for the latest instructions before submitting.
        </p>
        <div className="space-y-2">
          {COMMON_QUESTIONS.map((item) => (
            <details key={item.title} className="group rounded-lg border border-gray-200 bg-white px-3 py-2">
              <summary className="cursor-pointer list-none text-sm font-medium text-gray-800 flex items-center justify-between gap-3">
                <span>{item.title}</span>
                <span className="text-gray-400 group-open:rotate-180 transition-transform">v</span>
              </summary>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">{item.body}</p>
            </details>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm font-semibold text-gray-900">My Questions</p>
          <button
            onClick={() => navigate('/help/new')}
            className="text-sm text-blue-600 font-medium active:opacity-70"
          >
            + Ask a question
          </button>
        </div>

        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
        )}

        {!isLoading && questions.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            No questions yet. Tap "Ask a question" to get started.
          </p>
        )}

        {questions.map((q) => (
          <div
            key={q.id}
            onClick={() => navigate(`/help/questions/${q.id}`)}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3 active:bg-gray-50"
          >
            <div className="flex justify-between items-start gap-2 mb-1">
              <p className="text-sm text-gray-900 line-clamp-2 flex-1">{q.question_text}</p>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  q.status === 'answered'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {q.status === 'answered' ? 'Answered' : 'Open'}
              </span>
            </div>
            <p className="text-xs text-gray-400">{formatDate(q.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
