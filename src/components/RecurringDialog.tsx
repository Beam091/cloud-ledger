import { Check, LoaderCircle, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { inputDate } from '../lib/format'
import type { Account, Recurring } from '../types'

export function RecurringDialog({ accounts, existing, onClose, onSave, notify }: { accounts: Account[]; existing?: Recurring; onClose: () => void; onSave: (input: { account_id: string; transfer_account_id?: string; type: string; amount: number; category: string; description: string; frequency: 'daily' | 'weekly' | 'monthly'; start_date: string }, id?: string) => Promise<void>; notify: (message: string) => void }) {
  const [type, setType] = useState<'income' | 'expense' | 'transfer'>(existing?.type || 'expense')
  const [accountId, setAccountId] = useState(existing?.account_id || accounts[0]?.id || '')
  const [transferAccountId, setTransferAccountId] = useState(existing?.transfer_account_id || '')
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [category, setCategory] = useState(existing?.category || 'ค่าใช้จ่ายประจำ')
  const [description, setDescription] = useState(existing?.description || '')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>(existing?.frequency || 'monthly')
  const [startDate, setStartDate] = useState(inputDate(existing ? `${existing.next_run_date}T00:00:00+07:00` : undefined))
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (type === 'transfer' && (!transferAccountId || transferAccountId === accountId)) { notify('กรุณาเลือกบัญชีปลายทางที่ต่างจากบัญชีต้นทาง'); return }
    const input = { account_id: accountId, transfer_account_id: type === 'transfer' ? transferAccountId : undefined, type, amount: Number(amount), category, description, frequency, start_date: startDate }
    setBusy(true)
    try { await onSave(input, existing?.id) }
    catch (error) { notify(error instanceof Error ? error.message : 'บันทึกรายการประจำไม่สำเร็จ') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><form className="modal account-modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="section-kicker">RECURRING</span><h2>{existing ? 'แก้ไขรายการประจำ' : 'เพิ่มรายการประจำ'}</h2></div><button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div>
    <div className="two-field-row"><label>ประเภท<select value={type} onChange={(event) => setType(event.target.value as 'income' | 'expense' | 'transfer')}><option value="expense">รายจ่าย</option><option value="income">รายรับ</option><option value="transfer">โอนเงินระหว่างบัญชี</option></select></label><label>รอบ<select value={frequency} onChange={(event) => setFrequency(event.target.value as 'daily' | 'weekly' | 'monthly')}><option value="daily">ทุกวัน</option><option value="weekly">ทุกสัปดาห์</option><option value="monthly">ทุกเดือน</option></select></label></div>
    <div className="two-field-row"><label>จำนวนเงิน (บาท)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><label>วันเริ่มรอบแรก<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label></div>
    <div className="two-field-row">{type === 'transfer' ? <><label>จากบัญชี<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>ไปบัญชี<select value={transferAccountId} onChange={(event) => setTransferAccountId(event.target.value)} required><option value="" disabled>เลือกบัญชีปลายทาง</option>{accounts.filter((account) => account.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></> : <><label>หมวดหมู่<input value={category} onChange={(event) => setCategory(event.target.value)} required /></label><label>บัญชี<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></>}</div>
    <label>รายละเอียด<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="เช่น ค่าเช่าบ้าน" /></label>
    <small className="field-hint">ระบบจะสร้างรายการให้เองเมื่อถึงรอบ (ตรวจทุก 15 นาที) — แก้ไขถัดไปได้เสมอ</small>
    <button className="primary-button modal-submit" disabled={busy || !accounts.length}>{busy ? <LoaderCircle size={16} className="spin" /> : existing ? <Check size={16} /> : <Plus size={16} />}{existing ? 'บันทึกการแก้ไข' : 'เพิ่มรายการประจำ'}</button>
  </form></div>
}
