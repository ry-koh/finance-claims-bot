import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuestion, useEditQuestion, useDeleteQuestion } from '../api/help'
import { useAuth } from '../context/AuthContext'

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
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: question, isLoading, error } = useQuestion(id)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const editQuestion = useEditQuestion(id)
  const deleteQuestion = useDeleteQuestion({
    onSuccess: () => navigate('/help', { replace: true }),
  })

  const isAsker = question?.asker_id === user?.id

  function handleEditStart() {
    setEditText(question.question_text)
    setEditing(true)
  }

  function handleEditSave() {
    if (!editText.trim()) return
    editQuestion.mutate(
      { question_text: editText.trim() },
      { onSuccess: () => setEditing(false) }
    )
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }
  if (error || !question) {
    return <div className="p-4 text-sm text-red-600">Failed to load question.</div>
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        {editing ? (
          <>
            <textarea
              className="w-full border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              rows={5}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={handleEditSave}
                disabled={!editText.trim() || editQuestion.isPending}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg active:bg-blue-700 disabled:opacity-50"
              >
                {editQuestion.isPending ? 'Saving...' : 'Save'}
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
              {isAsker && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleEditStart}
                    className="text-xs text-blue-500 active:opacity-70"
                  >
                    Edit
                  </button>
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-500">Delete?</p>
                      <button
                        onClick={() => deleteQuestion.mutate(id)}
                        disabled={deleteQuestion.isPending}
                        className="text-xs text-red-600 font-semibold active:opacity-70 disabled:opacity-50"
                      >
                        {deleteQuestion.isPending ? 'Deleting...' : 'Yes'}
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
                  )}
                </div>
              )}
            </div>
          </>
        )}
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
