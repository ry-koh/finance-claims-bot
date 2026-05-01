import { useQuery } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const PORTFOLIO_KEYS = {
  all: ['portfolios'],
  ccas: (portfolioId) => ['portfolios', portfolioId, 'ccas'],
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
