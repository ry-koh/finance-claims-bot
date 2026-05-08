import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const PORTFOLIO_KEYS = {
  all: ['portfolios'],
  ccas: (portfolioId) => ['portfolios', portfolioId, 'ccas'],
  allCcas: ['portfolios', 'all-ccas'],
}

// Raw API calls
export const fetchAllCcasPublic = () =>
  api.get('/portfolios/ccas/public').then((r) => r.data)

export const fetchPortfolios = () =>
  api.get('/portfolios').then((r) => r.data)

export const fetchCcasByPortfolio = (portfolioId) =>
  api.get(`/portfolios/${portfolioId}/ccas`).then((r) => r.data)

// TanStack Query hooks
export function usePortfolios() {
  return useQuery({
    queryKey: PORTFOLIO_KEYS.all,
    queryFn: fetchPortfolios,
  })
}

export function useCcasByPortfolio(portfolioId) {
  return useQuery({
    queryKey: PORTFOLIO_KEYS.ccas(portfolioId),
    queryFn: () => fetchCcasByPortfolio(portfolioId),
    enabled: !!portfolioId,
  })
}

export function usePublicCcas() {
  return useQuery({
    queryKey: ['portfolios', 'ccas', 'public'],
    queryFn: fetchAllCcasPublic,
  })
}

// Mutation hooks (director only)

export function useCreatePortfolio(options = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name) => api.post('/portfolios', { name }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEYS.all }),
    ...options,
  })
}

export function useUpdatePortfolio(options = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }) => api.patch(`/portfolios/${id}`, { name }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEYS.all }),
    ...options,
  })
}

export function useDeletePortfolio(options = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => api.delete(`/portfolios/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEYS.all }),
    ...options,
  })
}

export function useCreateCca(options = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ portfolioId, name }) =>
      api.post(`/portfolios/${portfolioId}/ccas`, { name }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEYS.all }),
    ...options,
  })
}

export function useUpdateCca(options = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, portfolio_id }) =>
      api.patch(`/portfolios/ccas/${id}`, { name, portfolio_id }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEYS.all }),
    ...options,
  })
}

export function useDeleteCca(options = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => api.delete(`/portfolios/ccas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEYS.all }),
    ...options,
  })
}

export function useAllCcas() {
  const { data: portfolios } = usePortfolios()

  return useQuery({
    queryKey: [...PORTFOLIO_KEYS.allCcas, (portfolios || []).map((p) => p.id).sort().join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        portfolios.map((p) =>
          fetchCcasByPortfolio(p.id).then((ccas) =>
            ccas.map((c) => ({ ...c, portfolio: p }))
          )
        )
      )
      return results.flat()
    },
    enabled: !!(portfolios?.length),
  })
}
