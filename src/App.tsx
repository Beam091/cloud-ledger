import { useEffect, useState } from 'react'
import {
  ArrowRight, Bell, Check, ChevronDown, CircleHelp, Clock3, FileText, LayoutDashboard,
  LoaderCircle, LogOut, Repeat, ShieldCheck, Wallet,
} from 'lucide-react'
import { api, clearLegacyToken, jsonBody } from './api'
import { APP_VERSION, fullDate } from './lib/format'
import { parseHash } from './lib/routing'
import type { Account, Budget, Dashboard, Page, PeriodFilter, Recurring, Transaction, User } from './types'
import { AuthScreen } from './components/AuthScreen'
import { Overview } from './components/Overview'
import { TransactionsPage } from './components/TransactionsPage'
import { AccountsPage } from './components/AccountsPage'
import { RecurringPage } from './components/RecurringPage'
import { NotificationSettings } from './components/NotificationSettings'
import { AdminPage } from './components/AdminPage'
import { TransactionDialog } from './components/TransactionDialog'
import { AccountDialog } from './components/AccountDialog'
import { RecurringDialog } from './components/RecurringDialog'
import { BudgetDialog } from './components/BudgetPanel'
import { HelpDialog } from './components/HelpDialog'
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [page, setPage] = useState<Page>(() => parseHash(window.location.hash).page)
  const [dashboard, setDashboard] = useState<Dashboard>({ accounts: [], transactions: [], balance: 0, income: 0, expense: 0, categories: [], trend: [], budgets: [] })
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([])
  const [recurringItems, setRecurringItems] = useState<Recurring[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialog, setDialog] = useState<'transaction' | 'account' | 'recurring' | 'budget' | 'help' | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [editingRecurring, setEditingRecurring] = useState<Recurring | null>(null)
  const [editingBudget, setEditingBudget] = useState<{ category?: string; amount?: number } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [transactionType, setTransactionType] = useState<'all' | 'income' | 'expense'>('all')
  const [overviewPeriod, setOverviewPeriod] = useState<PeriodFilter>(() => parseHash(window.location.hash).period || 'month')
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  const navigate = (next: Page) => {
    window.location.hash = `#/${next}`
    setPage(next)
  }

  const notify = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3500)
  }
  const reload = () => setRefresh((count) => count + 1)

  useEffect(() => {
    const onHash = () => {
      const { page: next, period } = parseHash(window.location.hash)
      setPage(next)
      if (period) setOverviewPeriod(period)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => { if (user && page === 'admin' && user.role !== 'admin') navigate('overview') }, [user, page])

  useEffect(() => {
    clearLegacyToken()
    api<{ user: User }>('/api/auth/me').then(({ user: current }) => setUser(current)).catch(() => { setUser(null) }).finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    if (!user) return
    api<Dashboard>(`/api/dashboard?period=${overviewPeriod}`).then(setDashboard).catch((error) => notify(error.message))
    api<Transaction[] | { results: Transaction[] }>('/api/transactions')
      .then((result) => setAllTransactions(Array.isArray(result) ? result : result.results))
      .catch((error) => notify(error instanceof Error ? error.message : 'โหลดรายการไม่สำเร็จ'))
    api<{ results: Recurring[] }>('/api/recurring').then(({ results }) => setRecurringItems(results)).catch(() => undefined)
  }, [user, refresh, overviewPeriod])

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* network hiccup: clear the view anyway */ }
    clearLegacyToken()
    setUser(null)
  }

  async function authenticate(email: string, password: string, isRegister: boolean) {
    setLoading(true)
    try {
      const response = await api<{ user: User }>(isRegister ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: jsonBody({ email, password }) })
      setUser(response.user)
      if (response.user.role !== 'admin' && parseHash(window.location.hash).page === 'admin') navigate('overview')
      notify(isRegister ? 'สร้างบัญชีเรียบร้อยแล้ว' : 'เข้าสู่ระบบสำเร็จ')
    } catch (error) { notify(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ') }
    finally { setLoading(false) }
  }

  async function saveTransaction(input: { account_id: string; transfer_account_id?: string; type: string; amount: number; category: string; description: string; transaction_date?: string }, transactionId?: string) {
    await api(transactionId ? `/api/transactions/${transactionId}` : '/api/transactions', { method: transactionId ? 'PATCH' : 'POST', body: jsonBody(input) })
    setEditingTransaction(null)
    setDialog(null)
    notify(transactionId ? 'แก้ไขรายการแล้ว' : 'บันทึกรายการแล้ว')
    reload()
  }

  const startTransaction = () => { setEditingTransaction(null); setDialog('transaction') }
  const startAccount = (account?: Account) => { setEditingAccount(account || null); setDialog('account') }
  const startRecurring = (item?: Recurring) => { setEditingRecurring(item || null); setDialog('recurring') }
  const startBudget = (category?: string) => { setEditingBudget(category ? { category } : null); setDialog('budget') }

  async function saveRecurring(input: { account_id: string; transfer_account_id?: string; type: string; amount: number; category: string; description: string; frequency: 'daily' | 'weekly' | 'monthly'; start_date: string }, recurringId?: string) {
    await api(recurringId ? `/api/recurring/${recurringId}` : '/api/recurring', { method: recurringId ? 'PATCH' : 'POST', body: jsonBody(recurringId ? { ...input, next_run_date: input.start_date } : input) })
    setDialog(null)
    setEditingRecurring(null)
    notify(recurringId ? 'แก้ไขรายการประจำแล้ว' : 'เพิ่มรายการประจำแล้ว')
    reload()
  }

  async function saveBudget(category: string, amount: number) {
    await api('/api/budgets', { method: 'PUT', body: jsonBody({ category, amount }) })
    setDialog(null)
    setEditingBudget(null)
    notify('บันทึกงบประมาณแล้ว')
    reload()
  }

  async function toggleRecurring(item: Recurring) {
    try {
      await api(`/api/recurring/${item.id}`, { method: 'PATCH', body: jsonBody({ is_active: !item.is_active }) })
      notify(item.is_active ? 'หยุดรายการประจำชั่วคราวแล้ว' : 'เริ่มรายการประจำแล้ว')
      reload()
    } catch (error) { notify(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ') }
  }

  function deleteRecurring(item: Recurring) {
    setConfirmRequest({
      title: 'ลบรายการประจำ',
      message: `ลบ "${item.description || item.category}" ใช่ไหม? รายการที่สร้างไปแล้วจะไม่ถูกลบ`,
      confirmLabel: 'ลบรายการประจำ',
      onConfirm: async () => {
        try { await api(`/api/recurring/${item.id}`, { method: 'DELETE' }); notify('ลบรายการประจำแล้ว'); reload() }
        catch (error) { notify(error instanceof Error ? error.message : 'ลบรายการประจำไม่สำเร็จ') }
      },
    })
  }

  function deleteBudget(budget: Budget) {
    setConfirmRequest({
      title: 'ลบงบประมาณ',
      message: `ลบงบประมาณหมวด "${budget.category}" ใช่ไหม?`,
      confirmLabel: 'ลบงบประมาณ',
      onConfirm: async () => {
        try { await api('/api/budgets', { method: 'PUT', body: jsonBody({ category: budget.category, amount: 0 }) }); notify('ลบงบประมาณแล้ว'); reload() }
        catch (error) { notify(error instanceof Error ? error.message : 'ลบงบประมาณไม่สำเร็จ') }
      },
    })
  }

  function deleteTransaction(transaction: Transaction) {
    setConfirmRequest({
      title: 'ลบรายการ',
      message: `ลบ "${transaction.description || transaction.category}" (${String(transaction.amount)} บาท) ใช่ไหม? ยอดบัญชีที่เกี่ยวข้องจะถูกปรับกลับทันที`,
      confirmLabel: 'ลบรายการ',
      onConfirm: async () => {
        try { await api(`/api/transactions/${transaction.id}`, { method: 'DELETE' }); notify('ลบรายการแล้ว'); reload() }
        catch (error) { notify(error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ') }
      },
    })
  }

  function deleteAccount(account: Account) {
    setConfirmRequest({
      title: `ลบบัญชี ${account.name}`,
      message: `บัญชี "${account.name}" และรายการที่เกี่ยวข้องทั้งหมดจะถูกลบถาวร และรูปสลิปที่เก็บไว้จะถูกลบตามไปด้วย การทำเช่นนี้ย้อนกลับไม่ได้`,
      confirmLabel: 'ลบบัญชี',
      onConfirm: async () => {
        try { await api(`/api/accounts/${account.id}`, { method: 'DELETE' }); notify('ลบบัญชีแล้ว'); reload() }
        catch (error) { notify(error instanceof Error ? error.message : 'ลบบัญชีไม่สำเร็จ') }
      },
    })
  }

  if (booting) return <div className="loading-screen"><LoaderCircle className="spin" /><span>กำลังเปิด Ledgerly</span></div>
  if (!user) return <AuthScreen onSubmit={authenticate} loading={loading} notice={notice} />

  const nav = [
    { id: 'overview' as const, label: 'ภาพรวม', icon: LayoutDashboard },
    { id: 'transactions' as const, label: 'รายการทั้งหมด', icon: FileText },
    { id: 'accounts' as const, label: 'บัญชีของฉัน', icon: Wallet },
    { id: 'recurring' as const, label: 'รายการประจำ', icon: Repeat },
    { id: 'settings' as const, label: 'การตั้งค่า', icon: Bell },
    ...(user.role === 'admin' ? [{ id: 'admin' as const, label: 'จัดการระบบ', icon: ShieldCheck }] : []),
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview" onClick={(event) => { event.preventDefault(); navigate('overview') }}>
          <span className="brand-symbol"><span /><span /><span /></span>
          <span className="brand-name">ledgerly<span>.</span> <small style={{ fontSize: '0.75rem', opacity: 0.65, fontWeight: 500 }}>{APP_VERSION}</small></span>
        </a>
        <div className="workspace-switch"><span className="workspace-mark">{user.email[0].toUpperCase()}</span><span className="workspace-copy"><b>บัญชีส่วนตัว</b><small>พื้นที่ทำงาน</small></span><ChevronDown size={15} /></div>
        <div className="nav-caption">เมนูหลัก</div>
        <nav className="main-nav" aria-label="เมนูหลัก">
          {nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'admin' && <span className="nav-admin">ADMIN</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className="help-panel" onClick={() => setDialog('help')}><span className="help-icon"><CircleHelp size={17} /></span><span className="help-copy"><b>ต้องการความช่วยเหลือ?</b><small>เปิดศูนย์ช่วยเหลือ</small></span><ArrowRight size={15} /></button>
          <div className="profile"><span className="avatar">{user.email[0].toUpperCase()}</span><span className="profile-copy"><b>{user.email.split('@')[0]}</b><small>{user.role === 'admin' ? 'ผู้ดูแลระบบ' : user.email}</small></span><button className="row-action logout-button" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout}><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>พื้นที่ทำงาน</span><span className="crumb-slash">/</span><b>{nav.find((item) => item.id === page)?.label}</b></div>
          <div className="top-actions">
            <span className="today-label"><Clock3 size={14} />{fullDate}</span>
            <button className="icon-button notification-button" aria-label="ตั้งค่าการแจ้งเตือน" title="ตั้งค่าการแจ้งเตือน" onClick={() => navigate('settings')}><Bell size={18} /></button>
            <button className="icon-button header-logout" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout}><LogOut size={16} /></button>
            <span className="top-avatar">{user.email[0].toUpperCase()}</span>
          </div>
        </header>

        {page === 'overview' && <Overview dashboard={dashboard} period={overviewPeriod} onPeriodChange={(period) => { setOverviewPeriod(period); window.location.hash = `#/overview/${period}` }} onAdd={startTransaction} onNavigate={navigate} onBudgetAdd={startBudget} onBudgetEdit={(budget) => { setEditingBudget({ category: budget.category, amount: budget.limit }); setDialog('budget') }} onBudgetDelete={deleteBudget} />}
        {page === 'transactions' && <TransactionsPage transactions={allTransactions} query={query} onQuery={setQuery} typeFilter={transactionType} onTypeFilter={setTransactionType} onAdd={startTransaction} onDelete={deleteTransaction} onEdit={(transaction) => { setEditingTransaction(transaction); setDialog('transaction') }} />}
        {page === 'accounts' && <AccountsPage accounts={dashboard.accounts} onAdd={() => startAccount()} onEdit={startAccount} onDelete={deleteAccount} />}
        {page === 'recurring' && <RecurringPage items={recurringItems} accounts={dashboard.accounts} onAdd={() => startRecurring()} onEdit={startRecurring} onToggle={toggleRecurring} onDelete={deleteRecurring} />}
        {page === 'settings' && <NotificationSettings notify={notify} />}
        {page === 'admin' && user.role === 'admin' && <AdminPage currentUserId={user.id} adminEmail={user.email} notify={notify} />}
        <footer className="page-footer"><span>Ledgerly {APP_VERSION}</span><span>จัดการทุกบาท อย่างสบายใจ</span><span className="footer-status"><i /> ข้อมูลของคุณถูกแยกเก็บอย่างปลอดภัย</span></footer>
      </main>

      {dialog === 'transaction' && <TransactionDialog accounts={dashboard.accounts} existing={editingTransaction || undefined} onClose={() => { setDialog(null); setEditingTransaction(null) }} onSave={saveTransaction} onUploaded={() => { setDialog(null); notify('อ่านและบันทึกสลิปแล้ว'); reload() }} notify={notify} />}
      {dialog === 'account' && <AccountDialog existing={editingAccount || undefined} onClose={() => { setDialog(null); setEditingAccount(null) }} onSaved={() => { setDialog(null); notify(editingAccount ? 'แก้ไขบัญชีแล้ว' : 'เพิ่มบัญชีแล้ว'); setEditingAccount(null); reload() }} notify={notify} />}
      {dialog === 'recurring' && <RecurringDialog accounts={dashboard.accounts} existing={editingRecurring || undefined} onClose={() => { setDialog(null); setEditingRecurring(null) }} onSave={saveRecurring} notify={notify} />}
      {dialog === 'budget' && <BudgetDialog category={editingBudget?.category} amount={editingBudget?.amount} editing={editingBudget?.amount !== undefined} knownCategories={dashboard.categories.map((item) => item.category)} onClose={() => { setDialog(null); setEditingBudget(null) }} onSave={saveBudget} notify={notify} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} onNavigate={(target) => { setDialog(null); navigate(target) }} isAdmin={user.role === 'admin'} />}
      {confirmRequest && <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />}
      {notice && <div className="toast"><Check size={17} />{notice}</div>}
    </div>
  )
}

export default App
