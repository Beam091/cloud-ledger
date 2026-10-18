export type Account = { id: string; name: string; type: string; balance: number; currency: string }
export type Transaction = { id: string; account_id: string; account_name?: string; type: 'income' | 'expense' | 'transfer'; amount: number; category: string; description: string | null; transaction_date: string; image_url?: string | null }
export type User = { id: string; email: string; role: 'admin' | 'user' }
export type Dashboard = { accounts: Account[]; transactions: Transaction[]; balance: number; income: number; expense: number; categories: Array<{ category: string; total: number }>; trend: Array<{ day: string; total: number }> }
export type Page = 'overview' | 'transactions' | 'accounts' | 'settings' | 'admin'
export type PeriodFilter = 'day' | 'week' | 'month'
