import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuestion, usePostAnswer, useDeleteQuestion, useEditAnswer } from '../api/help'
import { useAuth, useIsFinanceTeam } from '../context/AuthContext'
import { imageUrl } from '../api/images'

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

function AnswerCard({ answer, questionId }) {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editAnswer = useEditAnswer(questionId, answer.id)

  const isOwn = answer.answerer_id === user?.id

  function handleEditStart() {
    setEditText(answer.answer_text)
    setEditing(true)
  }

  function handleEditSave() {
    if (!editText.trim()) return
    editAnswer.mutate(
      { answer_text: editText.trim() },
      { onSuccess: () => setEditing(false) }
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-[11px] font-semibold text-blue-600 mb-1">{answer.answerer_name}</p>
      {editing ? (
        <>
          <textarea
            className="w-full border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            rows={4}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleEditSave}
              disabled={!editText.trim() || editAnswer.isPending}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg active:bg-blue-700 disabled:opacity-50"
            >
              {editAnswer.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-gray-500 text-xs active:opacity-70"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{answer.answer_text}</p>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{formatDate(answer.created_at)}</p>
            {isOwn && (
              <button
                onClick={handleEditStart}
                className="text-xs text-blue-500 active:opacity-70"
              >
                Edit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function HelpInboxThreadPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFinanceTeam = useIsFinanceTeam()
  const { data: question, isLoading } = useQuestion(id)
  const [answerText, setAnswerText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const postAnswer = usePostAnswer(id)
  const deleteQuestion = useDeleteQuestion({
    onSuccess: () => navigate('/help-inbox', { replace: true }),
  })

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
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">{formatDate(question.created_at)}</p>
          {isFinanceTeam && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">Delete this question?</p>
                <button
                  onClick={() => deleteQuestion.mutate(id)}
                  disabled={deleteQuestion.isPending}
                  className="text-xs text-red-600 font-semibold active:opacity-70 disabled:opacity-50"
                >
                  {deleteQuestion.isPending ? 'Deleting...' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-gray-500 active:opacity-70"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-500 active:opacity-70"
              >
                Delete
              </button>
            )
          )}
        </div>
      </div>

      {question.answers?.length > 0 && (
        <div className="space-y-3">
          {question.answers.map((a) => (
            <AnswerCard key={a.id} answer={a} questionId={id} />
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
