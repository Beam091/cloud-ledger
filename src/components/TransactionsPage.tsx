import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, LoaderCircle, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import { dateLabel, money } from '../lib/format'
import type { Transaction } from '../types'
import { EmptyState } from './EmptyState'

export function TransactionTable({ transactions, compact = false, onDelete, onEdit }: { transactions: Transaction[]; compact?: boolean; onDelete?: (transaction: Transaction) => void; onEdit?: (transaction: Transaction) => void }) {
  if (!transactions.length) return <EmptyState title="ยังไม่มีรายการ" detail="บันทึกรายการแรกของคุณได้เลย" />
  return <div className="table-scroll"><table className="transaction-table"><thead><tr><th>รายการ</th><th>หมวดหมู่</th><th>บัญชี</th><th>วันที่</th><th className="amount-head">จำนวนเงิน</th>{(onDelete || onEdit) && <th />}</tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><span className={`transaction-mark ${item.type === 'income' ? 'mark-income' : item.type === 'transfer' ? 'mark-transfer' : 'mark-expense'}`}>{item.type === 'income' ? <ArrowDownLeft size={16} /> : item.type === 'transfer' ? <ArrowLeftRight size={16} /> : <ArrowUpRight size={16} />}</span><span className="transaction-title"><b>{item.description || item.category}</b><small>{item.type === 'income' ? 'รายรับ' : item.type === 'transfer' ? 'โอนเงิน' : 'รายจ่าย'}</small></span></td><td><span className="category-tag">{item.category}</span></td><td className="table-account">{item.type === 'transfer' ? `${item.account_name || 'บัญชี'} → ${item.transfer_account_name || '-'}` : item.account_name || 'บัญชี'}</td><td className="table-date">{dateLabel(item.transaction_date)}</td><td className={`table-amount ${item.type === 'income' ? 'income-text' : ''}`}>{item.type === 'income' ? '+' : item.type === 'transfer' ? '' : '−'}{item.type === 'transfer' ? ' ' : ' ฿ '}{money(item.amount)}</td>{(onDelete || onEdit) && <td><span className="row-actions">{onEdit && <button className="row-action" aria-label="แก้ไขรายการ" onClick={() => onEdit(item)}><Pencil size={14} /></button>}{onDelete && <button className="row-action" aria-label="ลบรายการ" onClick={() => onDelete(item)}><Trash2 size={15} /></button>}</span></td>}</tr>)}</tbody></table>{compact && transactions.length === 0 ? null : null}</div>
}

export function TransactionsPage({
  transactions,
  query,
  onQuery,
  typeFilter,
  onTypeFilter,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onAdd,
  onDelete,
  onEdit,
}: {
  transactions: Transaction[]
  query: string
  onQuery: (value: string) => void
  typeFilter: 'all' | 'income' | 'expense' | 'transfer'
  onTypeFilter: (value: 'all' | 'income' | 'expense' | 'transfer') => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onAdd: () => void
  onDelete: (transaction: Transaction) => void
  onEdit: (transaction: Transaction) => void
}) {
  const [searchInput, setSearchInput] = useState(query)

  // Debounce search query by ~300ms
  useEffect(() => {
    setSearchInput(query)
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== query) onQuery(searchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, query, onQuery])

  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">จัดการรายการทั้งหมด</p><h1>รายการของคุณ</h1><p className="heading-sub">ตรวจสอบและค้นหารายรับรายจ่ายย้อนหลัง</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> เพิ่มรายการ</button></div>
    <div className="list-toolbar">
      <label className="search-field">
        <Search size={17} />
        <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ค้นหารายการ หรือหมวดหมู่" />
      </label>
      <label className="filter-button">
        <Settings2 size={16} />
        <select aria-label="กรองประเภทรายการ" value={typeFilter} onChange={(event) => onTypeFilter(event.target.value as 'all' | 'income' | 'expense' | 'transfer')}>
          <option value="all">ทุกรายการ</option>
          <option value="income">รายรับ</option>
          <option value="expense">รายจ่าย</option>
          <option value="transfer">โอนเงิน</option>
        </select>
      </label>
      <span className="result-count">{transactions.length} รายการ</span>
    </div>
    <section className="transactions-panel full-transactions">
      <TransactionTable transactions={transactions} onDelete={onDelete} onEdit={onEdit} />
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
          <button className="outline-button" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <LoaderCircle className="spin" size={15} /> : null}
            {loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
          </button>
        </div>
      )}
    </section>
  </section>
}
