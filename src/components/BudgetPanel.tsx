import { LoaderCircle, Pencil, Plus, Trash2, WalletCards, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { money } from '../lib/format'
import type { Budget } from '../types'

// Monthly category budgets with progress bars; limits are stored per category
export function BudgetPanel({ budgets, categories, onAdd, onEdit, onDelete }: { budgets: Budget[]; categories: string[]; onAdd: (category?: string) => void; onEdit: (budget: Budget) => void; onDelete: (budget: Budget) => void }) {
  return <section className="transactions-panel budget-panel">
    <div className="section-top transaction-section-top"><div><span className="section-kicker">MONTHLY BUDGETS</span><h2>งบประมาณรายเดือน</h2></div><button className="text-link" onClick={() => onAdd()}><Plus size={14} /> เพิ่มงบ</button></div>
    {budgets.length ? <div className="budget-list">
      {budgets.map((budget) => {
        const percent = budget.limit > 0 ? Math.min(100, Math.round((budget.spent / budget.limit) * 100)) : 0
        const status = budget.spent > budget.limit ? 'over' : percent >= 90 ? 'warn' : 'ok'
        return <div className="budget-row" key={budget.category}>
          <div className="budget-head"><b>{budget.category}</b><span className="budget-numbers">{money(budget.spent)} / {money(budget.limit)} บาท</span><span className="budget-percent">{Math.round((budget.limit > 0 ? budget.spent / budget.limit : 0) * 100)}%</span></div>
          <div className="budget-track"><span className="budget-fill" style={{ width: `${percent}%` }} data-status={status} /></div>
          <div className="budget-foot">
            <small>{status === 'over' ? 'เกินงบประมาณแล้ว' : status === 'warn' ? 'ใกล้เกินงบ (90%+)' : `เหลือ ${money(Math.max(0, budget.limit - budget.spent))} บาท`}</small>
            <span className="row-actions">
              <button className="row-action" aria-label={`แก้ไขงบ ${budget.category}`} title="แก้ไขงบ" onClick={() => onEdit(budget)}><Pencil size={14} /></button>
              <button className="row-action" aria-label={`ลบงบ ${budget.category}`} title="ลบงบ" onClick={() => onDelete(budget)}><Trash2 size={15} /></button>
            </span>
          </div>
        </div>
      })}
    </div> : <div className="budget-empty"><WalletCards size={19} /><div><b>ยังไม่ได้ตั้งงบประมาณ</b><small>กำหนดกรอบรายจ่ายต่อหมวด ระบบจะเตือนในสรุปแจ้งเตือนเมื่อใกล้เกิน</small></div><button className="outline-small" onClick={() => onAdd()}><Plus size={13} /> ตั้งงบ</button></div>}
    {!budgets.length && <ul className="budget-suggestions">{categories.slice(0, 4).map((category) => <li key={category}><button type="button" onClick={() => onAdd(category)}>{category}</button></li>)}</ul>}
  </section>
}

export function BudgetDialog({ category, amount, editing = false, knownCategories, onClose, onSave, notify }: { category?: string; amount?: number; editing?: boolean; knownCategories: string[]; onClose: () => void; onSave: (category: string, amount: number) => Promise<void>; notify: (message: string) => void }) {
  const [categoryValue, setCategoryValue] = useState(category || '')
  const [amountValue, setAmountValue] = useState(amount ? String(amount) : '')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!categoryValue.trim() || !(Number(amountValue) > 0)) { notify('กรุณากรอกหมวดหมู่และยอดงบประมาณ'); return }
    setBusy(true)
    try { await onSave(categoryValue.trim(), Number(amountValue)); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'บันทึกงบประมาณไม่สำเร็จ') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><form className="modal account-modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="section-kicker">MONTHLY BUDGET</span><h2>{editing ? `แก้ไขงบ “${category}”` : 'ตั้งงบประมาณ'}</h2></div><button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div>
    <label>หมวดหมู่<input list="budget-category-options" value={categoryValue} onChange={(event) => setCategoryValue(event.target.value)} placeholder="เช่น อาหาร" readOnly={editing} required /><datalist id="budget-category-options">{knownCategories.map((name) => <option key={name} value={name} />)}</datalist></label>
    <label>งบประมาณรายเดือน (บาท)<input type="number" min="0.01" step="0.01" value={amountValue} onChange={(event) => setAmountValue(event.target.value)} placeholder="0.00" required /></label>
    <button className="primary-button modal-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : null} {editing ? 'บันทึกการแก้ไข' : 'ตั้งงบประมาณ'}</button>
  </form></div>
}
