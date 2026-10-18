import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import { dateLabel, money } from '../lib/format'
import type { Account, Recurring } from '../types'
import { EmptyState } from './EmptyState'

const frequencyLabels: Record<Recurring['frequency'], string> = { daily: 'ทุกวัน', weekly: 'ทุกสัปดาห์', monthly: 'ทุกเดือน' }

export function RecurringPage({ items, accounts, onAdd, onEdit, onToggle, onDelete }: { items: Recurring[]; accounts: Account[]; onAdd: () => void; onEdit: (item: Recurring) => void; onToggle: (item: Recurring) => void; onDelete: (item: Recurring) => void }) {
  const hasAccounts = accounts.length > 0
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">SET IT AND FORGET IT</p><h1>รายการประจำ</h1><p className="heading-sub">ค่าเช่า ค่าเน็ต หรือเงินเดือน ระบบจะบันทึกให้เองตามรอบที่ตั้งไว้</p></div><button className="primary-button" onClick={onAdd} disabled={!hasAccounts}><Plus size={17} /> เพิ่มรายการประจำ</button></div>
    {!hasAccounts && <div className="accounts-empty"><EmptyState title="ต้องมีบัญชีก่อน" detail="เพิ่มบัญชีธนาคารหรือ e-Wallet ก่อนตั้งรายการประจำ" /></div>}
    <section className="transactions-panel">
      {items.length ? <div className="table-scroll"><table className="transaction-table">
        <thead><tr><th>รายการ</th><th>รอบ</th><th>บัญชี</th><th>วันถัดไป</th><th className="amount-head">จำนวนเงิน</th><th /></tr></thead>
        <tbody>
          {items.map((item) => <tr key={item.id} className={item.is_active ? '' : 'recurring-paused'}>
            <td><span className={`transaction-mark ${item.type === 'income' ? 'mark-income' : item.type === 'transfer' ? 'mark-transfer' : 'mark-expense'}`}>{item.type === 'income' ? <ArrowDownLeft size={16} /> : item.type === 'transfer' ? <ArrowLeftRight size={16} /> : <ArrowUpRight size={16} />}</span><span className="transaction-title"><b>{item.description || item.category}</b><small>{item.is_active ? 'กำลังทำงาน' : 'หยุดชั่วคราว'}</small></span></td>
            <td><span className="category-tag">{frequencyLabels[item.frequency]}</span></td>
            <td className="table-account">{item.type === 'transfer' ? `${item.account_name || 'บัญชี'} → ${item.transfer_account_name || '-'}` : item.account_name || 'บัญชี'}</td>
            <td className="table-date">{item.is_active ? dateLabel(`${item.next_run_date}T00:00:00+07:00`) : '-'}</td>
            <td className={`table-amount ${item.type === 'income' ? 'income-text' : ''}`}>{item.type === 'income' ? '+' : '−'} ฿ {money(item.amount)}</td>
            <td><span className="row-actions">
              <button className="row-action" aria-label="แก้ไขรายการประจำ" title="แก้ไข" onClick={() => onEdit(item)}><Pencil size={14} /></button>
              <button className="row-action" aria-label={item.is_active ? 'หยุดชั่วคราว' : 'เริ่มทำงาน'} title={item.is_active ? 'หยุดชั่วคราว' : 'เริ่มทำงาน'} onClick={() => onToggle(item)}>{item.is_active ? <Pause size={14} /> : <Play size={14} />}</button>
              <button className="row-action" aria-label="ลบรายการประจำ" title="ลบ" onClick={() => onDelete(item)}><Trash2 size={15} /></button>
            </span></td>
          </tr>)}
        </tbody>
      </table></div> : <EmptyState title="ยังไม่มีรายการประจำ" detail="ตั้งรายการที่เกิดซ้ำ เช่น ค่าเช่า หรือค่าขนส่ง เพื่อให้ระบบบันทึกให้เอง" />}
    </section>
    {!items.length && hasAccounts && <div className="accounts-empty"><button className="outline-button" onClick={onAdd}><Repeat size={16} /> ตั้งรายการประจำแรกของคุณ</button></div>}
  </section>
}
