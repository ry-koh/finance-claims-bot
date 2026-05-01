import { useQuery } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const PORTFOLIO_KEYS = {
  all: ['portfolios'],
  ccas: (portfolioId) => ['portfolios', portfolioId, 'ccas'],
  allCcas: ['portfolios', 'all-ccas'],
}

// Raw API calls
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

export function useAllCcas() {
  const { data: portfolios } = usePortfolios()

  return useQuery({
    queryKey: [...PORTFOLIO_KEYS.allCcas, (portfolios || []).map((p) => p.id)],
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
