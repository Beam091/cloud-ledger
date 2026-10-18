import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronDown, CreditCard, Plus, TrendingDown, Wallet } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { accountKinds, categoryMarks, money } from '../lib/format'
import type { Dashboard, Page, PeriodFilter } from '../types'
import { EmptyState } from './EmptyState'
import { TransactionTable } from './TransactionsPage'

const SpendChart = lazy(() => import('./SpendChart'))

export function Overview({ dashboard, period, onPeriodChange, onAdd, onNavigate }: { dashboard: Dashboard; period: PeriodFilter; onPeriodChange: (period: PeriodFilter) => void; onAdd: () => void; onNavigate: (page: Page) => void }) {
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
      <section className="insight-panel"><div className="section-top"><div><span className="section-kicker">สรุปการใช้จ่าย</span><h2>{periodLabels[period]}เป็นอย่างไร</h2></div><label className="period-select"><span className="sr-only">เลือกช่วงเวลาภาพรวม</span><select value={period} onChange={(event) => onPeriodChange(event.target.value as PeriodFilter)}><option value="day">วัน</option><option value="week">สัปดาห์</option><option value="month">เดือน</option></select><ChevronDown size={13} /></label></div><div className="insight-total"><strong>฿ {money(dashboard.expense)}</strong><span className="positive-change"><TrendingDown size={14} /> รายจ่ายรวม</span></div><div className="spend-chart"><Suspense fallback={null}><SpendChart data={chartData} /></Suspense></div><div className="chart-range"><span>{rangeLabel(rangeStart)}</span><span>{rangeLabel(rangeEnd)}</span></div></section>
      <section className="accounts-panel"><div className="section-top"><div><span className="section-kicker">FINANCIAL ACCOUNTS</span><h2>บัญชีของฉัน <span className="count-pill">{dashboard.accounts.length}</span></h2></div><button className="text-link" onClick={() => onNavigate('accounts')}>ดูทั้งหมด <ArrowRight size={14} /></button></div>{dashboard.accounts.length ? <div className="account-list">{dashboard.accounts.slice(0, 3).map((account, index) => <AccountRow key={account.id} account={account} index={index} />)}</div> : <EmptyState title="ยังไม่มีบัญชี" detail="เพิ่มบัญชีแรกเพื่อเริ่มจัดการเงิน" />}</section>
      <section className="category-panel"><div className="section-top"><div><span className="section-kicker">SPENDING BREAKDOWN</span><h2>หมวดหมู่ยอดนิยม</h2></div><button className="more-quiet" aria-label="ดูรายการทั้งหมด" title="ดูรายการทั้งหมด" onClick={() => onNavigate('transactions')}><ArrowRight size={16} /></button></div>{dashboard.categories.length ? <div className="category-list">{dashboard.categories.map((item, index) => <div className="category-row" key={item.category}><span className="category-glyph" style={{ background: ['#f6ece2', '#edf1e8', '#f7f2df', '#eaf0ed', '#f3e9e4'][index % 5], color: ['#c47d48', '#6b876f', '#b89a46', '#628377', '#ad745e'][index % 5] }}>{categoryMarks[item.category] || item.category.slice(0, 1)}</span><span className="category-name">{item.category}</span><span className="category-amount">฿ {money(item.total)}</span></div>)}</div> : <EmptyState title={`ยังไม่มีข้อมูล${periodLabels[period]}`} detail="รายการใช้จ่ายจะแสดงตรงนี้" />}</section>
    </div>
    <section className="transactions-panel"><div className="section-top transaction-section-top"><div><span className="section-kicker">RECENT ACTIVITY</span><h2>รายการล่าสุด</h2></div><button className="text-link" onClick={() => onNavigate('transactions')}>ดูรายการทั้งหมด <ArrowRight size={14} /></button></div><TransactionTable transactions={dashboard.transactions} compact /></section>
  </section>
}

function AccountRow({ account, index }: { account: Dashboard['accounts'][number]; index: number }) {
  const styles = ['account-bank', 'account-wallet', 'account-cash', 'account-other']
  return <div className="account-row"><span className={`account-icon ${styles[index % styles.length]}`}>{account.type === 'cash' ? <Wallet size={17} /> : account.type === 'e_wallet' ? <CreditCard size={17} /> : <span className="bank-glyph">{account.name.slice(0, 1)}</span>}</span><span className="account-name-wrap"><b>{account.name}</b><small>{accountKinds[account.type] || 'อื่น ๆ'}</small></span><span className="account-balance">฿ {money(account.balance)}</span></div>
}
