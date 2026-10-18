import type { Page, PeriodFilter } from '../types'

export const knownPages: Page[] = ['overview', 'recurring', 'transactions', 'accounts', 'settings', 'admin']

// The active page (and overview range) lives in the URL hash so a browser
// refresh, or a shared link, restores the exact view: #/overview/week etc.
export function parseHash(hash: string): { page: Page; period: PeriodFilter | null } {
  const [page = '', param = ''] = hash.replace(/^#\/?/, '').split('/')
  const knownPage = knownPages.includes(page as Page) ? (page as Page) : 'overview'
  const period = param === 'day' || param === 'week' || param === 'month' ? param : null
  return { page: knownPage, period: knownPage === 'overview' ? (period as PeriodFilter | null) : null }
}
