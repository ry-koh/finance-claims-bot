import { useState } from 'react'
import {
  usePortfolios,
  useCcasByPortfolio,
  useCreatePortfolio,
  useUpdatePortfolio,
  useDeletePortfolio,
  useCreateCca,
  useUpdateCca,
  useDeleteCca,
} from '../api/portfolios'
import { useTeamMembers } from '../api/admin'
import { IconPencil, IconTrash, IconCheck, IconX, IconPlus } from '../components/Icons'

function extractError(err) {
  return err?.response?.data?.detail ?? err?.message ?? 'Something went wrong'
}

// ---------------------------------------------------------------------------
// Inline editable text field
// ---------------------------------------------------------------------------
function InlineEdit({ value, onSave, onCancel }) {
  const [text, setText] = useState(value)
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => { e.preventDefault(); onSave(text.trim()) }}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="text-sm border border-blue-400 rounded px-2 py-0.5 outline-none w-40"
      />
      <button type="submit" className="text-green-600 hover:text-green-700">
        <IconCheck />
      </button>
      <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
        <IconX />
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Add-new inline form
// ---------------------------------------------------------------------------
function AddForm({ placeholder, onSave, onCancel }) {
  const [text, setText] = useState('')
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSave(text.trim()) }}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="text-sm border border-blue-400 rounded px-2 py-0.5 outline-none w-44"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="text-green-600 hover:text-green-700 disabled:opacity-30"
      >
        <IconCheck />
      </button>
      <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
        <IconX />
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Inline delete confirmation panel
// ---------------------------------------------------------------------------
function DeleteConfirm({ label, affectedTreasurers, onConfirm, onCancel, isPending }) {
  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
      <p className="font-medium text-red-700 mb-1">Delete {label}?</p>
      {affectedTreasurers.length > 0 ? (
        <>
          <p className="text-red-600 mb-1">
            The following treasurer{affectedTreasurers.length !== 1 ? 's' : ''} will be unassigned:
          </p>
          <ul className="list-disc list-inside text-red-600 mb-2 space-y-0.5">
            {affectedTreasurers.map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-red-600 mb-2">No treasurers are assigned to this. This cannot be undone.</p>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onConfirm}
          disabled={isPending}
          className="flex-1 py-1 bg-red-600 text-white rounded font-semibold disabled:opacity-50"
        >
          {isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          onClick={onCancel}
          disabled={isPending}
          className="flex-1 py-1 bg-white border border-gray-200 text-gray-600 rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CCA row
// ---------------------------------------------------------------------------
function CcaRow({ cca, allMembers }) {
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState(null)
  const updateCca = useUpdateCca()
  const deleteCca = useDeleteCca()

  const affectedTreasurers = allMembers.filter(
    (m) => m.role === 'treasurer' && m.ccas?.some((c) => c.id === cca.id)
  )

  const handleSave = async (name) => {
    setError(null)
    try {
      await updateCca.mutateAsync({ id: cca.id, name })
      setEditing(false)
    } catch (err) {
      setError(extractError(err))
    }
  }

  const handleDelete = async () => {
    setError(null)
    try {
      await deleteCca.mutateAsync(cca.id)
    } catch (err) {
      setConfirmingDelete(false)
      setError(extractError(err))
    }
  }

  return (
    <li className="py-1.5">
      <div className="flex items-center gap-2 group">
        <span className="w-3 shrink-0 text-gray-300">└</span>
        {editing ? (
          <InlineEdit value={cca.name} onSave={handleSave} onCancel={() => { setEditing(false); setError(null) }} />
        ) : (
          <>
            <span className="text-sm text-gray-700 flex-1">{cca.name}</span>
            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setEditing(true)}
                className="text-gray-400 hover:text-blue-600"
                title="Rename"
              >
                <IconPencil />
              </button>
              <button
                onClick={() => { setConfirmingDelete(true); setError(null) }}
                disabled={deleteCca.isPending}
                className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                title="Delete"
              >
                <IconTrash />
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-500 ml-4 mt-0.5">{error}</p>}
      {confirmingDelete && (
        <div className="ml-4">
          <DeleteConfirm
            label={`"${cca.name}"`}
            affectedTreasurers={affectedTreasurers}
            onConfirm={handleDelete}
            onCancel={() => setConfirmingDelete(false)}
            isPending={deleteCca.isPending}
          />
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Portfolio card
// ---------------------------------------------------------------------------
function PortfolioCard({ portfolio, allMembers }) {
  const [editingPortfolio, setEditingPortfolio] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [addingCca, setAddingCca] = useState(false)
  const [portfolioError, setPortfolioError] = useState(null)
  const [ccaError, setCcaError] = useState(null)

  const { data: ccas = [], isLoading } = useCcasByPortfolio(portfolio.id)
  const updatePortfolio = useUpdatePortfolio()
  const deletePortfolio = useDeletePortfolio()
  const createCca = useCreateCca()

  const ccaIds = new Set(ccas.map((c) => c.id))
  const affectedTreasurers = allMembers.filter(
    (m) => m.role === 'treasurer' && m.ccas?.some((c) => ccaIds.has(c.id))
  )

  const handleRenamePortfolio = async (name) => {
    setPortfolioError(null)
    try {
      await updatePortfolio.mutateAsync({ id: portfolio.id, name })
      setEditingPortfolio(false)
    } catch (err) {
      setPortfolioError(extractError(err))
    }
  }

  const handleDeletePortfolio = async () => {
    setPortfolioError(null)
    try {
      await deletePortfolio.mutateAsync(portfolio.id)
    } catch (err) {
      setConfirmingDelete(false)
      setPortfolioError(extractError(err))
    }
  }

  const handleAddCca = async (name) => {
    setCcaError(null)
    try {
      await createCca.mutateAsync({ portfolioId: portfolio.id, name })
      setAddingCca(false)
    } catch (err) {
      setCcaError(extractError(err))
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      {/* Portfolio header */}
      <div className="flex items-center gap-2 group">
        {editingPortfolio ? (
          <InlineEdit
            value={portfolio.name}
            onSave={handleRenamePortfolio}
            onCancel={() => { setEditingPortfolio(false); setPortfolioError(null) }}
          />
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gray-900 flex-1">{portfolio.name}</h2>
            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setEditingPortfolio(true)}
                className="text-gray-400 hover:text-blue-600"
                title="Rename portfolio"
              >
                <IconPencil />
              </button>
              <button
                onClick={() => { setConfirmingDelete(true); setPortfolioError(null) }}
                disabled={deletePortfolio.isPending}
                className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                title="Delete portfolio"
              >
                <IconTrash />
              </button>
            </div>
          </>
        )}
      </div>
      {portfolioError && <p className="text-xs text-red-500 mt-1">{portfolioError}</p>}

      {confirmingDelete && (
        <DeleteConfirm
          label={`portfolio "${portfolio.name}" and all its CCAs`}
          affectedTreasurers={affectedTreasurers}
          onConfirm={handleDeletePortfolio}
          onCancel={() => setConfirmingDelete(false)}
          isPending={deletePortfolio.isPending}
        />
      )}

      {/* CCA list */}
      {isLoading ? (
        <p className="text-xs text-gray-400 mt-2 pl-4">Loading…</p>
      ) : (
        <ul className="mt-2 pl-2">
          {ccas.map((cca) => (
            <CcaRow key={cca.id} cca={cca} allMembers={allMembers} />
          ))}
          {ccas.length === 0 && !addingCca && (
            <li className="text-xs text-gray-400 pl-5 py-1">No CCAs</li>
          )}
          {addingCca && (
            <li className="flex items-center gap-1 py-1.5 pl-5">
              <AddForm
                placeholder="CCA name"
                onSave={handleAddCca}
                onCancel={() => { setAddingCca(false); setCcaError(null) }}
              />
              {ccaError && <p className="text-xs text-red-500 ml-1">{ccaError}</p>}
            </li>
          )}
        </ul>
      )}

      {/* Add CCA button */}
      {!addingCca && (
        <button
          onClick={() => setAddingCca(true)}
          className="mt-2 ml-5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          <IconPlus className="w-3.5 h-3.5" /> Add CCA
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function CcasPage() {
  const { data: portfolios = [], isLoading, isError } = usePortfolios()
  const { data: allMembers = [] } = useTeamMembers()
  const [addingPortfolio, setAddingPortfolio] = useState(false)
  const [portfolioError, setPortfolioError] = useState(null)
  const createPortfolio = useCreatePortfolio()

  const handleAddPortfolio = async (name) => {
    setPortfolioError(null)
    try {
      await createPortfolio.mutateAsync(name)
      setAddingPortfolio(false)
    } catch (err) {
      setPortfolioError(extractError(err))
    }
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-sm text-red-500">Failed to load portfolios.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      <div className="bg-white px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Portfolios &amp; CCAs</h1>
          {!addingPortfolio && (
            <button
              onClick={() => setAddingPortfolio(true)}
              className="text-sm text-blue-600 font-medium flex items-center gap-1"
            >
              <IconPlus className="w-4 h-4" /> Portfolio
            </button>
          )}
        </div>
        {addingPortfolio && (
          <div className="mt-3 flex items-center gap-1">
            <AddForm
              placeholder="Portfolio name"
              onSave={handleAddPortfolio}
              onCancel={() => { setAddingPortfolio(false); setPortfolioError(null) }}
            />
            {portfolioError && <p className="text-xs text-red-500 ml-1">{portfolioError}</p>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-24 mb-2 ml-5" />
                <div className="h-3 bg-gray-100 rounded w-28 ml-5" />
              </div>
            ))}
          </>
        ) : portfolios.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No portfolios yet. Add one above.
          </div>
        ) : (
          portfolios.map((p) => (
            <PortfolioCard key={p.id} portfolio={p} allMembers={allMembers} />
          ))
        )}
      </div>
    </div>
  )
}
