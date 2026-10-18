import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown,
  CircleHelp, Clock3, CreditCard, Eye, EyeOff, FileImage, FileText, LayoutDashboard, LoaderCircle,
  LockKeyhole, LogOut, Mail, Pencil, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, TrendingDown, Wallet, X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, getToken, jsonBody, setToken } from './api'

type Account = { id: string; name: string; type: string; balance: number; currency: string }
type Transaction = { id: string; account_id: string; account_name?: string; type: 'income' | 'expense' | 'transfer'; amount: number; category: string; description: string | null; transaction_date: string; image_url?: string | null }
type User = { id: string; email: string; role: 'admin' | 'user' }
type Dashboard = { accounts: Account[]; transactions: Transaction[]; balance: number; income: number; expense: number; categories: Array<{ category: string; total: number }>; trend: Array<{ day: string; total: number }> }
type Page = 'overview' | 'transactions' | 'accounts' | 'settings' | 'admin'

const money = (amount: number) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
const dateLabel = (value: string) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(value))
const inputDate = (value?: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value ? new Date(value) : new Date())
const fullDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long' }).format(new Date())
const accountKinds: Record<string, string> = { bank: 'ธนาคาร', e_wallet: 'e-Wallet', cash: 'เงินสด', other: 'อื่น ๆ' }
const categoryMarks: Record<string, string> = { อาหาร: 'F', เดินทาง: 'T', ช้อปปิ้ง: 'S', ที่อยู่อาศัย: 'H', สุขภาพ: 'W', รายรับ: '↗' }
const APP_VERSION = 'v1.0.6'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(Boolean(getToken()))
  const [page, setPage] = useState<Page>('overview')
  const [dashboard, setDashboard] = useState<Dashboard>({ accounts: [], transactions: [], balance: 0, income: 0, expense: 0, categories: [], trend: [] })
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialog, setDialog] = useState<'transaction' | 'account' | 'help' | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [transactionType, setTransactionType] = useState<'all' | 'income' | 'expense'>('all')
  const [overviewPeriod, setOverviewPeriod] = useState<'day' | 'week' | 'month'>('month')

  const notify = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3500)
  }
  const reload = () => setRefresh((count) => count + 1)

  useEffect(() => {
    if (!getToken()) { setBooting(false); return }
    api<{ user: User }>('/api/auth/me').then(({ user: current }) => setUser(current)).catch(() => { setToken(null); setUser(null) }).finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    if (!user) return
    api<Dashboard>(`/api/dashboard?period=${overviewPeriod}`).then(setDashboard).catch((error) => notify(error.message))
    api<Transaction[]>('/api/transactions').then(setAllTransactions).catch(() => undefined)
  }, [user, refresh, overviewPeriod])

  async function authenticate(email: string, password: string, isRegister: boolean) {
    setLoading(true)
    try {
      const response = await api<{ token: string; user: User }>(isRegister ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: jsonBody({ email, password }) })
      setToken(response.token)
      setUser(response.user)
      notify(isRegister ? 'สร้างบัญชีเรียบร้อยแล้ว' : 'เข้าสู่ระบบสำเร็จ')
    } catch (error) { notify(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ') }
    finally { setLoading(false) }
  }

  async function saveTransaction(input: { account_id: string; type: string; amount: number; category: string; description: string; transaction_date?: string }, transactionId?: string) {
    await api(transactionId ? `/api/transactions/${transactionId}` : '/api/transactions', { method: transactionId ? 'PATCH' : 'POST', body: jsonBody(input) })
    setEditingTransaction(null)
    setDialog(null)
    notify(transactionId ? 'แก้ไขรายการแล้ว' : 'บันทึกรายการแล้ว')
    reload()
  }

  const startTransaction = () => { setEditingTransaction(null); setDialog('transaction') }
  const startAccount = (account?: Account) => { setEditingAccount(account || null); setDialog('account') }

  async function deleteTransaction(transaction: Transaction) {
    if (!window.confirm('ลบรายการนี้ใช่ไหม?')) return
    try { await api(`/api/transactions/${transaction.id}`, { method: 'DELETE' }); notify('ลบรายการแล้ว'); reload() }
    catch (error) { notify(error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ') }
  }

  async function deleteAccount(account: Account) {
    if (!window.confirm(`ลบบัญชี ${account.name} และรายการที่เกี่ยวข้องทั้งหมดใช่ไหม?`)) return
    try { await api(`/api/accounts/${account.id}`, { method: 'DELETE' }); notify('ลบบัญชีแล้ว'); reload() }
    catch (error) { notify(error instanceof Error ? error.message : 'ลบบัญชีไม่สำเร็จ') }
  }

  if (booting) return <div className="loading-screen"><LoaderCircle className="spin" /><span>กำลังเปิด Ledgerly</span></div>
  if (!user) return <AuthScreen onSubmit={authenticate} loading={loading} notice={notice} />

  const nav = [
    { id: 'overview' as const, label: 'ภาพรวม', icon: LayoutDashboard },
    { id: 'transactions' as const, label: 'รายการทั้งหมด', icon: FileText },
    { id: 'accounts' as const, label: 'บัญชีของฉัน', icon: Wallet },
    { id: 'settings' as const, label: 'การแจ้งเตือน', icon: Bell },
    ...(user.role === 'admin' ? [{ id: 'admin' as const, label: 'จัดการระบบ', icon: ShieldCheck }] : []),
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setPage('overview') }}>
          <span className="brand-symbol"><span /><span /><span /></span>
          <span className="brand-name">ledgerly<span>.</span> <small style={{ fontSize: '0.75rem', opacity: 0.65, fontWeight: 500 }}>{APP_VERSION}</small></span>
        </a>
        <div className="workspace-switch"><span className="workspace-mark">{user.email[0].toUpperCase()}</span><span className="workspace-copy"><b>บัญชีส่วนตัว</b><small>พื้นที่ทำงาน</small></span><ChevronDown size={15} /></div>
        <div className="nav-caption">เมนูหลัก</div>
        <nav className="main-nav" aria-label="เมนูหลัก">
          {nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'admin' && <span className="nav-admin">ADMIN</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className="help-panel" onClick={() => setDialog('help')}><span className="help-icon"><CircleHelp size={17} /></span><span className="help-copy"><b>ต้องการความช่วยเหลือ?</b><small>เปิดศูนย์ช่วยเหลือ</small></span><ArrowRight size={15} /></button>
          <div className="profile"><span className="avatar">{user.email[0].toUpperCase()}</span><span className="profile-copy"><b>{user.email.split('@')[0]}</b><small>{user.role === 'admin' ? 'ผู้ดูแลระบบ' : user.email}</small></span><button className="row-action logout-button" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={() => { setToken(null); setUser(null) }}><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>พื้นที่ทำงาน</span><span className="crumb-slash">/</span><b>{nav.find((item) => item.id === page)?.label}</b></div>
          <div className="top-actions">
            <span className="today-label"><Clock3 size={14} />{fullDate}</span>
            <button className="icon-button notification-button" aria-label="ตั้งค่าการแจ้งเตือน" title="ตั้งค่าการแจ้งเตือน" onClick={() => setPage('settings')}><Bell size={18} /></button>
            <button className="icon-button header-logout" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={() => { setToken(null); setUser(null) }}><LogOut size={16} /></button>
            <span className="top-avatar">{user.email[0].toUpperCase()}</span>
          </div>
        </header>

        {page === 'overview' && <Overview dashboard={dashboard} period={overviewPeriod} onPeriodChange={setOverviewPeriod} onAdd={startTransaction} onNavigate={setPage} />}
        {page === 'transactions' && <TransactionsPage transactions={allTransactions} query={query} onQuery={setQuery} typeFilter={transactionType} onTypeFilter={setTransactionType} onAdd={startTransaction} onDelete={deleteTransaction} onEdit={(transaction) => { setEditingTransaction(transaction); setDialog('transaction') }} />}
        {page === 'accounts' && <AccountsPage accounts={dashboard.accounts} onAdd={() => startAccount()} onEdit={startAccount} onDelete={deleteAccount} />}
        {page === 'settings' && <NotificationSettings notify={notify} />}
        {page === 'admin' && user.role === 'admin' && <AdminPage currentUserId={user.id} adminEmail={user.email} notify={notify} />}
        <footer className="page-footer"><span>Ledgerly {APP_VERSION}</span><span>จัดการทุกบาท อย่างสบายใจ</span><span className="footer-status"><i /> ข้อมูลของคุณถูกแยกเก็บอย่างปลอดภัย</span></footer>
      </main>

      {dialog === 'transaction' && <TransactionDialog accounts={dashboard.accounts} existing={editingTransaction || undefined} onClose={() => { setDialog(null); setEditingTransaction(null) }} onSave={saveTransaction} onUploaded={() => { setDialog(null); notify('อ่านและบันทึกสลิปแล้ว'); reload() }} notify={notify} />}
      {dialog === 'account' && <AccountDialog existing={editingAccount || undefined} onClose={() => { setDialog(null); setEditingAccount(null) }} onSaved={() => { setDialog(null); notify(editingAccount ? 'แก้ไขบัญชีแล้ว' : 'เพิ่มบัญชีแล้ว'); setEditingAccount(null); reload() }} notify={notify} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} onNavigate={(target) => { setDialog(null); setPage(target) }} isAdmin={user.role === 'admin'} />}
      {notice && <div className="toast"><Check size={17} />{notice}</div>}
    </div>
  )
}

function HelpDialog({ onClose, onNavigate, isAdmin }: { onClose: () => void; onNavigate: (page: Page) => void; isAdmin: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <div className="modal-head"><div><span className="section-kicker">LEDGERLY HELP</span><h2 id="help-title">ศูนย์ช่วยเหลือ</h2></div><button className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div>
    <p className="help-dialog-copy">เลือกส่วนที่ต้องการจัดการได้เลย หากมีปัญหาเกี่ยวกับการเข้าใช้ กรุณาติดต่อผู้ดูแลระบบของ workspace นี้</p>
    <div className="help-options"><button onClick={() => onNavigate('accounts')}><Wallet size={17} /><span><b>บัญชีการเงิน</b><small>เพิ่ม แก้ไข หรือตรวจยอดบัญชี</small></span><ArrowRight size={15} /></button><button onClick={() => onNavigate('settings')}><Bell size={17} /><span><b>การแจ้งเตือน</b><small>เลือกช่องทางและเวลาส่งสรุป</small></span><ArrowRight size={15} /></button>{isAdmin && <button onClick={() => onNavigate('admin')}><Settings2 size={17} /><span><b>การตั้งค่าระบบ</b><small>AI, Gmail sender และนโยบายรูปภาพ</small></span><ArrowRight size={15} /></button>}</div>
  </section></div>
}

function AuthScreen({ onSubmit, loading, notice }: { onSubmit: (email: string, password: string, register: boolean) => void; loading: boolean; notice: string }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'login' || mode === 'register') {
      onSubmit(email, password, mode === 'register')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      if (mode === 'forgot') {
        const result = await api<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: jsonBody({ email }) })
        setStatus(result.message)
        setMode('reset')
      } else {
        const result = await api<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: jsonBody({ email, code: otp, password }) })
        setStatus(result.message)
        setPassword('')
        setOtp('')
        setMode('login')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function changeMode(next: 'login' | 'register' | 'forgot' | 'reset') {
    setStatus('')
    setMode(next)
  }

  const heading = mode === 'register' ? 'เริ่มต้นได้เลย' : mode === 'forgot' ? 'ลืมรหัสผ่าน' : mode === 'reset' ? 'ตั้งรหัสผ่านใหม่' : 'ยินดีที่ได้พบกัน'
  const subtitle = mode === 'register' ? 'สร้างบัญชีเพื่อจัดการการเงินในแบบของคุณ' : mode === 'forgot' ? 'กรอกอีเมลที่ใช้สมัครเพื่อรับรหัส OTP' : mode === 'reset' ? 'กรอกรหัส OTP จากอีเมลและตั้งรหัสผ่านใหม่' : 'เข้าสู่ระบบเพื่อดูภาพรวมการเงินของคุณ'

  return <main className="auth-screen">
    <div className="auth-art"><div className="art-grid" /><div className="art-copy"><div className="brand brand-light"><span className="brand-symbol"><span /><span /><span /></span><span className="brand-name">ledgerly<span>.</span></span></div><p className="art-kicker">YOUR MONEY, IN FOCUS</p><h1>เห็นทุกการใช้จ่าย<br /><em>เข้าใจทุกการเติบโต</em></h1><p className="art-description">ภาพรวมการเงินที่ชัดเจน เริ่มต้นจากทุกวันที่คุณใช้ชีวิต</p><div className="art-illustration"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="chart-glass"><div className="chart-head"><span>ยอดเงินรวม</span><span>THB</span></div><strong>฿ 84,250<span>.00</span></strong><div className="art-chart"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div><div className="chart-foot"><i /> เติบโตต่อเนื่อง <b>+12.8%</b></div></div><div className="float-chip chip-income"><ArrowDownLeft size={16} /><span><small>รายรับเดือนนี้</small><b>+ ฿32,500</b></span></div><div className="float-chip chip-ai"><Sparkles size={15} /><span>AI จัดหมวดหมู่ให้แล้ว</span></div></div><div className="art-footer"><span>01 / 03</span><span className="art-progress"><i /></span><span>การเงินที่เรียบง่าย</span></div></div></div>
    <div className="auth-form-side"><div className="auth-form-wrap">
      <div className="auth-mobile-brand"><span className="brand-symbol"><span /><span /><span /></span><span className="brand-name">ledgerly<span>.</span></span></div>
      <div className="auth-eyebrow"><span /> FINANCIAL WELLNESS, REIMAGINED · {APP_VERSION}</div>
      <h2>{heading}</h2><p className="auth-subtitle">{subtitle}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>อีเมล<div className="field-with-icon"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required disabled={mode === 'reset'} /></div></label>
        {mode === 'reset' && <label>รหัส OTP<div className="field-with-icon"><LockKeyhole size={17} /><input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="รหัส 6 หลัก" minLength={6} maxLength={6} required /></div></label>}
        {(mode === 'login' || mode === 'register' || mode === 'reset') && <label>{mode === 'reset' ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'}<div className="field-with-icon"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /><button className="password-toggle" type="button" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {mode === 'login' && <button type="button" className="auth-forgot" onClick={() => changeMode('forgot')}>ลืมรหัสผ่าน?</button>}
        <button className="primary-button auth-submit" disabled={loading || busy}>{loading || busy ? <LoaderCircle size={17} className="spin" /> : null}{mode === 'register' ? 'สร้างบัญชี' : mode === 'forgot' ? 'ส่งรหัส OTP' : mode === 'reset' ? 'ตั้งรหัสผ่านใหม่' : 'เข้าสู่ระบบ'}<ArrowRight size={17} /></button>
      </form>
      {(mode === 'forgot' || mode === 'reset') && <button type="button" className="auth-back" onClick={() => changeMode('login')}><ArrowLeft size={14} /> กลับเข้าสู่ระบบ</button>}
      {mode === 'reset' && <button type="button" className="auth-resend" onClick={() => changeMode('forgot')}>ขอ OTP ใหม่</button>}
      {(mode === 'login' || mode === 'register') && <div className="auth-switch">{mode === 'register' ? 'มีบัญชีอยู่แล้ว?' : 'ยังไม่มีบัญชี?'} <button onClick={() => changeMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button></div>}
      {(status || notice) && <div className="auth-notice">{status || notice}</div>}
      <div className="auth-note"><ShieldCheck size={16} /> เข้ารหัสข้อมูลและแยกพื้นที่ส่วนตัวของคุณ</div>
    </div><div className="auth-legal"><span>© 2026 Ledgerly</span><span>นโยบายความเป็นส่วนตัว</span></div></div>
  </main>
}

function Overview({ dashboard, period, onPeriodChange, onAdd, onNavigate }: { dashboard: Dashboard; period: 'day' | 'week' | 'month'; onPeriodChange: (period: 'day' | 'week' | 'month') => void; onAdd: () => void; onNavigate: (page: Page) => void }) {
  const periodLabels = { day: 'วันนี้', week: 'สัปดาห์นี้', month: 'เดือนนี้' }
  const chartData = dashboard.trend.map((item) => ({
    name: period === 'day' ? 'วันนี้' : period === 'week'
      ? new Intl.DateTimeFormat('th-TH', { weekday: 'short' }).format(new Date(`${item.day}T12:00:00+07:00`))
      : String(Number(item.day.slice(-2))),
    value: Math.round(item.total),
  }))
  const rangeStart = dashboard.trend[0]?.day
  const rangeEnd = dashboard.trend.at(-1)?.day
  const rangeLabel = (value?: string) => value ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00+07:00`)) : '-'
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">{new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} <span className="heading-dot" /></p><h1>ภาพรวมการเงิน</h1><p className="heading-sub">สรุปข้อมูล{periodLabels[period]}</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> เพิ่มรายการ</button></div>
    <div className="overview-grid">
      <section className="balance-panel"><div className="balance-top"><div><span className="balance-label">ยอดเงินรวมทั้งหมด</span><span className="balance-period"><i /> ทุกบัญชีของคุณ</span></div><button className="dark-icon-button" aria-label="ดูบัญชีทั้งหมด" title="ดูบัญชีทั้งหมด" onClick={() => onNavigate('accounts')}><ArrowRight size={16} /></button></div><div className="balance-number"><span className="baht">฿</span>{money(dashboard.balance)}<span className="balance-decimal">THB</span></div><div className="balance-divider" /><div className="balance-stats"><div><span><ArrowDownLeft size={14} /> รายรับ{periodLabels[period]}</span><b>฿ {money(dashboard.income)}</b></div><div><span><ArrowUpRight size={14} /> รายจ่าย{periodLabels[period]}</span><b>฿ {money(dashboard.expense)}</b></div><div className="balance-note">หลังหักรายจ่าย <b>฿ {money(dashboard.income - dashboard.expense)}</b></div></div><div className="balance-watermark">L</div></section>
      <section className="insight-panel"><div className="section-top"><div><span className="section-kicker">สรุปการใช้จ่าย</span><h2>{periodLabels[period]}เป็นอย่างไร</h2></div><label className="period-select"><span className="sr-only">เลือกช่วงเวลาภาพรวม</span><select value={period} onChange={(event) => onPeriodChange(event.target.value as 'day' | 'week' | 'month')}><option value="day">วัน</option><option value="week">สัปดาห์</option><option value="month">เดือน</option></select><ChevronDown size={13} /></label></div><div className="insight-total"><strong>฿ {money(dashboard.expense)}</strong><span className="positive-change"><TrendingDown size={14} /> รายจ่ายรวม</span></div><div className="spend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 4, left: -22, bottom: 0 }}><defs><linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c987f" stopOpacity={0.28} /><stop offset="100%" stopColor="#7c987f" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e9ebe5" strokeDasharray="3 5" /><XAxis dataKey="name" interval={Math.max(0, Math.floor(chartData.length / 5))} axisLine={false} tickLine={false} tick={{ fill: '#899087', fontSize: 10 }} tickMargin={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#a0a69c', fontSize: 10 }} tickFormatter={(value) => value >= 1000 ? `${value / 1000}k` : value} /><Tooltip formatter={(value) => [`฿${money(Number(value))}`, 'รายจ่าย']} contentStyle={{ border: '1px solid #e7e9e2', borderRadius: 8, fontSize: 12 }} /><Area type="monotone" dataKey="value" stroke="#68836c" strokeWidth={2.5} fill="url(#spendFill)" /></AreaChart></ResponsiveContainer></div><div className="chart-range"><span>{rangeLabel(rangeStart)}</span><span>{rangeLabel(rangeEnd)}</span></div></section>
      <section className="accounts-panel"><div className="section-top"><div><span className="section-kicker">FINANCIAL ACCOUNTS</span><h2>บัญชีของฉัน <span className="count-pill">{dashboard.accounts.length}</span></h2></div><button className="text-link" onClick={() => onNavigate('accounts')}>ดูทั้งหมด <ArrowRight size={14} /></button></div>{dashboard.accounts.length ? <div className="account-list">{dashboard.accounts.slice(0, 3).map((account, index) => <AccountRow key={account.id} account={account} index={index} />)}</div> : <EmptyState title="ยังไม่มีบัญชี" detail="เพิ่มบัญชีแรกเพื่อเริ่มจัดการเงิน" />}</section>
      <section className="category-panel"><div className="section-top"><div><span className="section-kicker">SPENDING BREAKDOWN</span><h2>หมวดหมู่ยอดนิยม</h2></div><button className="more-quiet" aria-label="ดูรายการทั้งหมด" title="ดูรายการทั้งหมด" onClick={() => onNavigate('transactions')}><ArrowRight size={16} /></button></div>{dashboard.categories.length ? <div className="category-list">{dashboard.categories.map((item, index) => <div className="category-row" key={item.category}><span className="category-glyph" style={{ background: ['#f6ece2', '#edf1e8', '#f7f2df', '#eaf0ed', '#f3e9e4'][index % 5], color: ['#c47d48', '#6b876f', '#b89a46', '#628377', '#ad745e'][index % 5] }}>{categoryMarks[item.category] || item.category.slice(0, 1)}</span><span className="category-name">{item.category}</span><span className="category-amount">฿ {money(item.total)}</span></div>)}</div> : <EmptyState title={`ยังไม่มีข้อมูล${periodLabels[period]}`} detail="รายการใช้จ่ายจะแสดงตรงนี้" />}</section>
    </div>
    <section className="transactions-panel"><div className="section-top transaction-section-top"><div><span className="section-kicker">RECENT ACTIVITY</span><h2>รายการล่าสุด</h2></div><button className="text-link" onClick={() => onNavigate('transactions')}>ดูรายการทั้งหมด <ArrowRight size={14} /></button></div><TransactionTable transactions={dashboard.transactions} compact /></section>
  </section>
}

function AccountRow({ account, index }: { account: Account; index: number }) {
  const styles = ['account-bank', 'account-wallet', 'account-cash', 'account-other']
  return <div className="account-row"><span className={`account-icon ${styles[index % styles.length]}`}>{account.type === 'cash' ? <Wallet size={17} /> : account.type === 'e_wallet' ? <CreditCard size={17} /> : <span className="bank-glyph">{account.name.slice(0, 1)}</span>}</span><span className="account-name-wrap"><b>{account.name}</b><small>{accountKinds[account.type] || 'อื่น ๆ'}</small></span><span className="account-balance">฿ {money(account.balance)}</span></div>
}

function TransactionTable({ transactions, compact = false, onDelete, onEdit }: { transactions: Transaction[]; compact?: boolean; onDelete?: (transaction: Transaction) => void; onEdit?: (transaction: Transaction) => void }) {
  if (!transactions.length) return <EmptyState title="ยังไม่มีรายการ" detail="บันทึกรายการแรกของคุณได้เลย" />
  return <div className="table-scroll"><table className="transaction-table"><thead><tr><th>รายการ</th><th>หมวดหมู่</th><th>บัญชี</th><th>วันที่</th><th className="amount-head">จำนวนเงิน</th>{(onDelete || onEdit) && <th />}</tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><span className={`transaction-mark ${item.type === 'income' ? 'mark-income' : 'mark-expense'}`}>{item.type === 'income' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><span className="transaction-title"><b>{item.description || item.category}</b><small>{item.type === 'income' ? 'รายรับ' : item.type === 'transfer' ? 'โอนเงิน' : 'รายจ่าย'}</small></span></td><td><span className="category-tag">{item.category}</span></td><td className="table-account">{item.account_name || 'บัญชี'}</td><td className="table-date">{dateLabel(item.transaction_date)}</td><td className={`table-amount ${item.type === 'income' ? 'income-text' : ''}`}>{item.type === 'income' ? '+' : '−'} ฿ {money(item.amount)}</td>{(onDelete || onEdit) && <td><span className="row-actions">{onEdit && <button className="row-action" aria-label="แก้ไขรายการ" onClick={() => onEdit(item)}><Pencil size={14} /></button>}{onDelete && <button className="row-action" aria-label="ลบรายการ" onClick={() => onDelete(item)}><Trash2 size={15} /></button>}</span></td>}</tr>)}</tbody></table>{compact && transactions.length === 0 ? null : null}</div>
}

function TransactionsPage({ transactions, query, onQuery, typeFilter, onTypeFilter, onAdd, onDelete, onEdit }: { transactions: Transaction[]; query: string; onQuery: (value: string) => void; typeFilter: 'all' | 'income' | 'expense'; onTypeFilter: (value: 'all' | 'income' | 'expense') => void; onAdd: () => void; onDelete: (transaction: Transaction) => void; onEdit: (transaction: Transaction) => void }) {
  const filtered = transactions.filter((item) => (typeFilter === 'all' || item.type === typeFilter) && `${item.description} ${item.category} ${item.account_name}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">จัดการรายการทั้งหมด</p><h1>รายการของคุณ</h1><p className="heading-sub">ตรวจสอบและค้นหารายรับรายจ่ายย้อนหลัง</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> เพิ่มรายการ</button></div>
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="ค้นหารายการ หรือหมวดหมู่" /></label><label className="filter-button"><Settings2 size={16} /><select aria-label="กรองประเภทรายการ" value={typeFilter} onChange={(event) => onTypeFilter(event.target.value as 'all' | 'income' | 'expense')}><option value="all">ทุกรายการ</option><option value="income">รายรับ</option><option value="expense">รายจ่าย</option></select></label><span className="result-count">{filtered.length} รายการ</span></div>
    <section className="transactions-panel full-transactions"><TransactionTable transactions={filtered} onDelete={onDelete} onEdit={onEdit} /></section>
  </section>
}

function AccountsPage({ accounts, onAdd, onEdit, onDelete }: { accounts: Account[]; onAdd: () => void; onEdit: (account: Account) => void; onDelete: (account: Account) => void }) {
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">FINANCIAL ACCOUNTS</p><h1>บัญชีของฉัน</h1><p className="heading-sub">รวมทุกช่องทางการเงินไว้ในที่เดียว</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> เพิ่มบัญชี</button></div>
    <div className="account-total"><div><span>ยอดเงินรวมทุกบัญชี</span><strong>฿ {money(accounts.reduce((sum, account) => sum + account.balance, 0))}</strong></div><span className="account-total-icon"><Wallet size={22} /></span></div>
    <div className="accounts-grid">
      {accounts.map((account, index) => <article className="account-card" key={account.id}>
        <div className="account-card-top"><span className={`account-icon ${['account-bank', 'account-wallet', 'account-cash', 'account-other'][index % 4]}`}>{account.type === 'cash' ? <Wallet size={18} /> : account.type === 'e_wallet' ? <CreditCard size={18} /> : <span className="bank-glyph">{account.name.slice(0, 1)}</span>}</span><span className="account-actions"><button className="row-action" aria-label={`แก้ไข ${account.name}`} onClick={() => onEdit(account)}><Pencil size={14} /></button><button className="row-action" aria-label={`ลบ ${account.name}`} onClick={() => onDelete(account)}><Trash2 size={15} /></button></span></div>
        <span className="account-card-kind">{accountKinds[account.type] || 'บัญชีอื่น ๆ'}</span><h2>{account.name}</h2><span className="account-card-label">ยอดเงินคงเหลือ</span><strong className="account-card-balance">฿ {money(account.balance)}</strong><div className="account-card-foot"><span>•••• {account.id.slice(-4).toUpperCase()}</span><span>{account.currency}</span></div>
      </article>)}
      <button className="add-account-card" onClick={onAdd}><span><Plus size={19} /></span><b>เพิ่มบัญชีใหม่</b><small>ธนาคาร, e-Wallet หรือเงินสด</small></button>
    </div>
    {!accounts.length && <div className="accounts-empty"><EmptyState title="เริ่มต้นจากบัญชีแรกของคุณ" detail="เพิ่มบัญชีธนาคาร e-Wallet หรือเงินสดเพื่อให้เห็นยอดรวมในที่เดียว" /><button className="outline-button" onClick={onAdd}><Plus size={16} /> เพิ่มบัญชี</button></div>}
  </section>
}

const notificationScheduleOptions = [
  { label: 'รายวัน', value: '0 21 * * *' },
  { label: 'รายสัปดาห์', value: '0 21 * * 1' },
  { label: 'รายเดือน', value: '0 21 1 * *' },
]

function getNotificationScheduleLabel(value: string) {
  const cron = String(value || '0 21 * * *')
  const option = notificationScheduleOptions.find((item) => item.value === cron)
  return option?.label || 'รายวัน'
}

function NotificationSettings({ notify }: { notify: (message: string) => void }) {
  const [form, setForm] = useState<Record<string, string | number | boolean>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Record<string, string | number | boolean>>('/api/notifications').then(setForm).catch((error) => notify(error.message)) }, [])
  const set = (key: string, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }))
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await api('/api/notifications', { method: 'PUT', body: jsonBody(form) }); notify('การตั้งค่าการแจ้งเตือนถูกบันทึกแล้ว') }
    catch (error) { notify(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  const scheduleValue = String(form.cron_schedule || '0 21 * * *')
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">STAY IN THE KNOW</p><h1>การแจ้งเตือน</h1><p className="heading-sub">เลือกช่องทางและเวลารับสรุปการเงิน</p></div></div>
    <form className="settings-form" onSubmit={save}>
      <div className="settings-intro"><span className="settings-intro-icon"><Bell size={19} /></span><div><b>{getNotificationScheduleLabel(scheduleValue)}</b><p>รับภาพรวมรายรับและรายจ่ายตามเวลาที่คุณเลือก</p></div><label className="time-select"><Clock3 size={15} /><select aria-label="เลือกช่วงเวลาส่งสรุป" value={scheduleValue} onChange={(event) => set('cron_schedule', event.target.value)}><option value="0 21 * * *">รายวัน</option><option value="0 21 * * 1">รายสัปดาห์</option><option value="0 21 1 * *">รายเดือน</option></select><small>ช่วงเวลา</small></label></div>
      <div className="channel-list">
        <ChannelCard icon={<Mail size={18} />} title="Gmail" description="ส่งสรุปไปยังอีเมลผู้ใช้ของคุณ" enabled={Boolean(form.gmail_enabled)} onEnabled={(value) => set('gmail_enabled', value)}><div className="settings-fields"><p className="field-hint"><LockKeyhole size={13} /> ระบบจะส่งอีเมลไปที่บัญชีของคุณโดยอัตโนมัติ ใช้ Gmail sender ที่ผู้ดูแลระบบตั้งค่าไว้</p></div></ChannelCard>
        <ChannelCard icon={<span className="telegram-glyph">➤</span>} title="Telegram" description="รับข้อความสรุปผ่าน Telegram Bot" enabled={Boolean(form.telegram_enabled)} onEnabled={(value) => set('telegram_enabled', value)}><div className="settings-fields two-col"><label>Bot Token<input type="password" placeholder={form.telegram_token_set ? 'บันทึกไว้อย่างปลอดภัยแล้ว' : 'ใส่ token จาก BotFather'} onChange={(event) => set('telegram_bot_token', event.target.value)} /></label><label>Chat ID<input placeholder="เช่น 123456789" value={String(form.telegram_chat_id || '')} onChange={(event) => set('telegram_chat_id', event.target.value)} /></label></div></ChannelCard>
        <ChannelCard icon={<span className="discord-glyph">◉</span>} title="Discord" description="ส่ง Rich Embed ไปยังเซิร์ฟเวอร์ของคุณ" enabled={Boolean(form.discord_enabled)} onEnabled={(value) => set('discord_enabled', value)}><div className="settings-fields"><label>Webhook URL<input type="url" placeholder={form.discord_webhook_set ? 'บันทึกไว้อย่างปลอดภัยแล้ว' : 'https://discord.com/api/webhooks/...'} onChange={(event) => set('discord_webhook_url', event.target.value)} /></label></div></ChannelCard>
      </div>
      <div className="settings-save-row"><span>ตั้งค่าเขตเวลาเป็น Asia/Bangkok</span><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} บันทึกการตั้งค่า</button></div>
    </form>
  </section>
}

function ChannelCard({ icon, title, description, enabled, onEnabled, children }: { icon: ReactNode; title: string; description: string; enabled: boolean; onEnabled: (value: boolean) => void; children: ReactNode }) {
  return <article className="channel-card"><div className="channel-head"><span className={`channel-icon ${title.toLowerCase()}`}>{icon}</span><div className="channel-title"><b>{title}</b><small>{description}</small></div><label className="toggle"><input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /><span /></label></div>{enabled && <div className="channel-body">{children}</div>}</article>
}

function AdminPage({ currentUserId, adminEmail, notify }: { currentUserId: string; adminEmail: string; notify: (message: string) => void }) {
  const [users, setUsers] = useState<Array<{ id: string; email: string; role: string; is_active: number; created_at: string }>>([])
  const [settings, setSettings] = useState<Record<string, string | boolean>>({})
  const [apiKey, setApiKey] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => Promise.all([api<{ results: typeof users }>('/api/admin/users'), api<Record<string, string | boolean>>('/api/admin/settings')]).then(([userResult, config]) => { setUsers(userResult.results); setSettings(config) }).catch((error) => notify(error.message))
  useEffect(() => { load() }, [])
  const update = async (id: string, values: { role?: string; is_active?: boolean }) => {
    try { await api(`/api/admin/users/${id}`, { method: 'PATCH', body: jsonBody(values) }); await load(); notify('อัปเดตผู้ใช้แล้ว') }
    catch (error) { notify(error instanceof Error ? error.message : 'อัปเดตไม่สำเร็จ') }
  }
  async function loadModels() {
    setModelsBusy(true)
    setModelsError('')
    try {
      const result = await api<{ models: string[] }>('/api/admin/ai/models', { method: 'POST', body: jsonBody({ base_url: String(settings.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai'), ...(apiKey ? { api_key: apiKey } : {}) }) })
      setModels(result.models)
      if (!result.models.length) setModelsError('ไม่พบโมเดลจาก base URL นี้')
      else if (!result.models.includes(String(settings.ai_model || ''))) setSettings((current) => ({ ...current, ai_model: result.models[0] }))
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'โหลดโมเดลไม่สำเร็จ')
    } finally {
      setModelsBusy(false)
    }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api('/api/admin/settings', { method: 'PUT', body: jsonBody({ ai_provider: 'openai-compatible', ai_base_url: String(settings.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai'), ai_model: settings.ai_model || 'gemini-3.5-flash-lite', ...(apiKey ? { ai_api_key: apiKey } : {}), image_retention_policy: settings.image_retention_policy || 'auto_cleanup', image_retention_days: String(settings.image_retention_days || '90'), smtp_from_email: settings.smtp_from_email || '', ...(smtpPassword ? { smtp_app_password: smtpPassword.replaceAll(' ', '') } : {}) }) })
      setApiKey('')
      setSmtpPassword('')
      await load()
      notify('บันทึกการตั้งค่าระบบแล้ว')
    }
    catch (error) { notify(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  async function sendTestEmail() {
    setTestingEmail(true)
    try { await api('/api/admin/settings/test-email', { method: 'POST', body: jsonBody({}) }); notify(`ส่งอีเมลทดสอบไปที่ ${adminEmail} แล้ว`) }
    catch (error) { notify(error instanceof Error ? error.message : 'ส่งอีเมลทดสอบไม่สำเร็จ') }
    finally { setTestingEmail(false) }
  }
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">SYSTEM CONTROL</p><h1>จัดการระบบ</h1><p className="heading-sub">ผู้ใช้ การประมวลผล AI อีเมล OTP และนโยบายรูปภาพ</p></div><span className="admin-badge"><ShieldCheck size={15} /> ผู้ดูแลระบบ</span></div>
    <div className="admin-layout">
      <section className="admin-section"><div className="admin-section-head"><div><span className="section-kicker">ACCESS CONTROL</span><h2>ผู้ใช้งาน <span className="count-pill">{users.length}</span></h2></div><button className="outline-small" onClick={() => load()}>รีเฟรช</button></div><div className="admin-users">{users.map((item) => <div className="admin-user-row" key={item.id}><span className="avatar">{item.email[0].toUpperCase()}</span><span className="profile-copy"><b>{item.email}</b><small>{new Date(item.created_at).toLocaleDateString('th-TH')}</small></span><select aria-label="สิทธิ์ผู้ใช้" title={item.id === currentUserId ? 'ไม่สามารถเปลี่ยนบทบาทบัญชีตัวเองได้' : 'เปลี่ยนสิทธิ์ผู้ใช้'} disabled={item.id === currentUserId} value={item.role} onChange={(event) => update(item.id, { role: event.target.value })}><option value="user">ผู้ใช้</option><option value="admin">ผู้ดูแล</option></select><button className={`status-pill ${item.is_active ? 'enabled' : 'disabled'}`} disabled={item.id === currentUserId} title={item.id === currentUserId ? 'ไม่สามารถปิดใช้งานบัญชีตัวเองได้' : ''} onClick={() => update(item.id, { is_active: !item.is_active })}>{item.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</button></div>)}</div></section>
      <form className="admin-section admin-config" onSubmit={saveSettings}>
        <div className="admin-section-head"><div><span className="section-kicker">AI & STORAGE POLICY</span><h2>การตั้งค่าระบบ</h2></div><Sparkles size={19} /></div>
        <label>AI base URL<input type="url" placeholder="https://generativelanguage.googleapis.com/v1beta/openai" value={String(settings.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai')} onChange={(event) => setSettings({ ...settings, ai_base_url: event.target.value })} /></label>
        <label>AI API Key<input type="password" placeholder={settings.ai_key_set ? 'ตั้งค่าแล้ว · เว้นว่างเพื่อใช้ค่าเดิม' : 'ใส่ API Key'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
        <div className="model-picker-row"><label>โมเดล AI<select value={String(settings.ai_model || 'gemini-3.5-flash-lite')} onChange={(event) => setSettings({ ...settings, ai_model: event.target.value })}><option value={String(settings.ai_model || 'gemini-3.5-flash-lite')}>{String(settings.ai_model || 'gemini-3.5-flash-lite')}</option>{models.filter((model) => model !== String(settings.ai_model || '')).map((model) => <option key={model} value={model}>{model}</option>)}</select></label><button type="button" className="outline-small" disabled={modelsBusy} onClick={loadModels}>{modelsBusy ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />} โหลดโมเดล</button></div>
        {modelsError && <p className="model-error" role="status">{modelsError}</p>}
        <label>นโยบายเก็บรูปภาพ<select value={String(settings.image_retention_policy || 'auto_cleanup')} onChange={(event) => setSettings({ ...settings, image_retention_policy: event.target.value })}><option value="full">full · เก็บตลอดไป</option><option value="auto_cleanup">auto_cleanup · ลบตามกำหนด</option><option value="data_only">data_only · ลบทันทีหลังอ่าน</option></select></label>
        {settings.image_retention_policy !== 'full' && settings.image_retention_policy !== 'data_only' && <label>เก็บรูปเป็นเวลา (วัน)<input type="number" min="1" max="3650" value={String(settings.image_retention_days || '90')} onChange={(event) => setSettings({ ...settings, image_retention_days: event.target.value })} /></label>}
        <div className="admin-divider"><span>ตั้งค่าอีเมลส่งรหัส OTP</span></div>
        <label>Gmail สำหรับส่งอีเมล<input type="email" autoComplete="email" placeholder="ledgerly@gmail.com" value={String(settings.smtp_from_email || '')} onChange={(event) => setSettings({ ...settings, smtp_from_email: event.target.value })} /></label>
        <label>Gmail App Password<input type="password" autoComplete="new-password" placeholder={settings.smtp_app_password_set ? 'ตั้งค่าแล้ว · เว้นว่างเพื่อใช้ค่าเดิม' : 'App Password 16 หลัก'} value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value.replaceAll(' ', ''))} /></label>
        <p className="field-hint"><LockKeyhole size={13} /> App Password ถูกเข้ารหัส AES-256-GCM ก่อนจัดเก็บ</p>
        <div className="admin-action-row"><button type="button" className="outline-small" disabled={testingEmail || !settings.smtp_from_email || !settings.smtp_app_password_set} onClick={sendTestEmail}>{testingEmail ? <LoaderCircle size={13} className="spin" /> : <Mail size={13} />} ส่งอีเมลทดสอบไปยังบัญชีนี้</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} บันทึกการตั้งค่า</button></div>
      </form>
    </div>
  </section>
}

function TransactionDialog({ accounts, existing, onClose, onSave, onUploaded, notify }: { accounts: Account[]; existing?: Transaction; onClose: () => void; onSave: (input: { account_id: string; type: string; amount: number; category: string; description: string; transaction_date?: string }, transactionId?: string) => Promise<void>; onUploaded: () => void; notify: (message: string) => void }) {
  const [mode, setMode] = useState<'manual' | 'ai'>(existing ? 'manual' : 'ai')
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [accountId, setAccountId] = useState(existing?.account_id || accounts[0]?.id || '')
  const [type, setType] = useState(existing?.type || 'expense')
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [category, setCategory] = useState(existing?.category || 'อาหาร')
  const [description, setDescription] = useState(existing?.description || '')
  const [transactionDate, setTransactionDate] = useState(inputDate(existing?.transaction_date))
  const [file, setFile] = useState<File | null>(null)
  const [slipReview, setSlipReview] = useState(false)
  async function parseText() {
    setParsing(true)
    try {
      const result = await api<{ parsed: { amount: number; type: 'income' | 'expense'; category: string; description: string; transaction_date?: string }; account_id: string }>('/api/ai/parse', { method: 'POST', body: jsonBody({ text }) })
      setAmount(String(result.parsed.amount)); setType(result.parsed.type); setCategory(result.parsed.category); setDescription(result.parsed.description); setAccountId(result.account_id)
      if (result.parsed.transaction_date) setTransactionDate(inputDate(result.parsed.transaction_date))
      setSlipReview(false); setMode('manual')
    } catch (error) { notify(error instanceof Error ? error.message : 'AI ประมวลผลไม่สำเร็จ') }
    finally { setParsing(false) }
  }
  async function previewSlip() {
    if (!file) return
    setSaving(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await api<{ parsed: { amount: number; type: 'income' | 'expense'; category: string; description: string; transaction_date?: string }; account_id: string }>('/api/ai/slip/preview', { method: 'POST', body: form })
      setAmount(String(result.parsed.amount)); setType(result.parsed.type); setCategory(result.parsed.category); setDescription(result.parsed.description); setAccountId(result.account_id)
      if (result.parsed.transaction_date) setTransactionDate(inputDate(result.parsed.transaction_date))
      setSlipReview(true); setMode('manual')
      notify('อ่านข้อมูลแล้ว กรุณาตรวจสอบก่อนยืนยันบันทึก')
    }
    catch (error) { notify(error instanceof Error ? error.message : 'อ่านสลิปไม่สำเร็จ') }
    finally { setSaving(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      if (slipReview && file) {
        const form = new FormData()
        form.append('file', file)
        form.append('account_id', accountId)
        form.append('type', type)
        form.append('amount', amount)
        form.append('category', category)
        form.append('description', description)
        form.append('transaction_date', transactionDate)
        await api('/api/ai/slip', { method: 'POST', body: form })
        onUploaded()
      } else {
        await onSave({ account_id: accountId, type, amount: Number(amount), category, description, transaction_date: new Date(`${transactionDate}T12:00:00+07:00`).toISOString() }, existing?.id)
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-head"><div><span className="section-kicker">{existing ? 'EDIT TRANSACTION' : 'NEW TRANSACTION'}</span><h2 id="transaction-title">{existing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</h2></div><button className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div><div className="mode-tabs"><button type="button" className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}><Sparkles size={15} /> AI ช่วยบันทึก</button><button type="button" className={mode === 'manual' ? 'selected' : ''} onClick={() => setMode('manual')}><FileText size={15} /> กรอกเอง</button></div>{mode === 'ai' && <div className="ai-entry"><label>เล่าให้เราฟังว่าเกิดอะไรขึ้น<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="เช่น กินข้าวขาหมู 80 บาท ตัดจาก TrueMoney" rows={3} /></label><button className="ai-parse-button" onClick={parseText} disabled={!text.trim() || parsing}>{parsing ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} วิเคราะห์ด้วย AI</button><div className="upload-divider"><span>หรือแนบสลิป / ใบเสร็จ</span></div><label className="upload-box"><input type="file" accept="image/*" onChange={(event) => { setFile(event.target.files?.[0] || null); setSlipReview(false) }} /><span className="upload-icon"><FileImage size={19} /></span><b>{file ? file.name : 'เลือกรูปภาพสลิปหรือใบเสร็จ'}</b><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PNG, JPG สูงสุด 8 MB'}</small></label>{file && <button className="primary-button upload-submit" onClick={previewSlip} disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} อ่านภาพเพื่อแสดงตัวอย่าง</button>}</div>}{mode === 'manual' && <form className="manual-form" onSubmit={submit}>{slipReview && <p className="slip-review-notice"><Sparkles size={15} /> ตรวจสอบยอดเงิน ประเภท และบัญชีให้ถูกต้อง รูปภาพจะถูกบันทึกพร้อมรายการเมื่อกดยืนยัน</p>}<label>ประเภท<div className="segmented"><button type="button" className={type === 'expense' ? 'selected expense' : ''} onClick={() => setType('expense')}><ArrowUpRight size={15} /> รายจ่าย</button><button type="button" className={type === 'income' ? 'selected income' : ''} onClick={() => setType('income')}><ArrowDownLeft size={15} /> รายรับ</button></div></label><label>จำนวนเงิน (บาท)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><div className="two-field-row"><label>หมวดหมู่<input value={category} onChange={(event) => setCategory(event.target.value)} required /></label><label>บัญชี<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div><label>วันที่<input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /></label><label>รายละเอียด<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="เช่น มื้อกลางวัน" /></label><button className="primary-button modal-submit" disabled={saving || !accounts.length}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{slipReview ? 'ยืนยันและบันทึกรายการ' : 'บันทึกรายการ'}</button></form>}</section></div>
}

function AccountDialog({ existing, onClose, onSaved, notify }: { existing?: Account; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [name, setName] = useState(existing?.name || '')
  const [type, setType] = useState(existing?.type || 'bank')
  const [balance, setBalance] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await api(existing ? `/api/accounts/${existing.id}` : '/api/accounts', { method: existing ? 'PATCH' : 'POST', body: jsonBody(existing ? { name, type } : { name, type, balance: Number(balance || 0) }) }); onSaved() } catch (error) { notify(error instanceof Error ? error.message : 'บันทึกบัญชีไม่สำเร็จ') } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal account-modal" onSubmit={submit}><div className="modal-head"><div><span className="section-kicker">FINANCIAL ACCOUNT</span><h2>{existing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'}</h2></div><button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div><label>ชื่อบัญชี<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น ธนาคารกสิกรไทย" required /></label><label>ประเภทบัญชี<select value={type} onChange={(event) => setType(event.target.value)}><option value="bank">ธนาคาร</option><option value="e_wallet">e-Wallet</option><option value="cash">เงินสด</option><option value="other">อื่น ๆ</option></select></label>{!existing && <label>ยอดเงินเริ่มต้น<input type="number" step="0.01" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="0.00" /></label>}<button className="primary-button modal-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : existing ? <Check size={16} /> : <Plus size={16} />}{existing ? 'บันทึกการแก้ไข' : 'เพิ่มบัญชี'}</button></form></div>
}

function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><span className="empty-mark"><FileText size={18} /></span><b>{title}</b><small>{detail}</small></div> }

export default App