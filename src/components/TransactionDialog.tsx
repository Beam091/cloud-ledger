import { Check, FileImage, FileText, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, jsonBody } from '../api'
import { inputDate } from '../lib/format'
import type { Account, Transaction } from '../types'

export function TransactionDialog({ accounts, existing, onClose, onSave, onUploaded, notify }: { accounts: Account[]; existing?: Transaction; onClose: () => void; onSave: (input: { account_id: string; transfer_account_id?: string; type: string; amount: number; category: string; description: string; transaction_date?: string }, transactionId?: string) => Promise<void>; onUploaded: () => void; notify: (message: string) => void }) {
  const [mode, setMode] = useState<'manual' | 'ai'>(existing ? 'manual' : 'ai')
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [accountId, setAccountId] = useState(existing?.account_id || accounts[0]?.id || '')
  const [type, setType] = useState(existing?.type || 'expense')
  const [transferAccountId, setTransferAccountId] = useState(existing?.transfer_account_id || '')
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
  function changeType(next: string) {
    const value = next as 'income' | 'expense' | 'transfer'
    setType(value)
    if (next === 'transfer') {
      if (!transferAccountId || transferAccountId === accountId) setTransferAccountId(accounts.find((account) => account.id !== accountId)?.id || '')
      setCategory((current) => current === 'อาหาร' ? 'โอนเงิน' : current)
    } else if (category === 'โอนเงิน') {
      setCategory('อาหาร')
    }
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
    if (type === 'transfer' && (!transferAccountId || transferAccountId === accountId)) { notify('กรุณาเลือกบัญชีปลายทางที่ต่างจากบัญชีต้นทาง'); return }
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
        await onSave({ account_id: accountId, transfer_account_id: type === 'transfer' ? transferAccountId : undefined, type, amount: Number(amount), category, description, transaction_date: new Date(`${transactionDate}T12:00:00+07:00`).toISOString() }, existing?.id)
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-head"><div><span className="section-kicker">{existing ? 'EDIT TRANSACTION' : 'NEW TRANSACTION'}</span><h2 id="transaction-title">{existing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</h2></div><button className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div><div className="mode-tabs"><button type="button" className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}><Sparkles size={15} /> AI ช่วยบันทึก</button><button type="button" className={mode === 'manual' ? 'selected' : ''} onClick={() => setMode('manual')}><FileText size={15} /> กรอกเอง</button></div>{mode === 'ai' && <div className="ai-entry"><label>เล่าให้เราฟังว่าเกิดอะไรขึ้น<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="เช่น กินข้าวขาหมู 80 บาท ตัดจาก TrueMoney" rows={3} /></label><button className="ai-parse-button" onClick={parseText} disabled={!text.trim() || parsing}>{parsing ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} วิเคราะห์ด้วย AI</button><div className="upload-divider"><span>หรือแนบสลิป / ใบเสร็จ</span></div><label className="upload-box"><input type="file" accept="image/*" onChange={(event) => { setFile(event.target.files?.[0] || null); setSlipReview(false) }} /><span className="upload-icon"><FileImage size={19} /></span><b>{file ? file.name : 'เลือกรูปภาพสลิปหรือใบเสร็จ'}</b><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PNG, JPG สูงสุด 8 MB'}</small></label>{file && <button className="primary-button upload-submit" onClick={previewSlip} disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} อ่านภาพเพื่อแสดงตัวอย่าง</button>}</div>}{mode === 'manual' && <form className="manual-form" onSubmit={submit}><div className="two-field-row"><label>ประเภท<select value={type} onChange={(event) => changeType(event.target.value)}><option value="expense">รายจ่าย</option><option value="income">รายรับ</option><option value="transfer">โอนเงินระหว่างบัญชี</option></select></label><label>จำนวนเงิน (บาท)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label></div><div className="two-field-row">{type === 'transfer' ? <><label>จากบัญชี<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>ไปบัญชี<select value={transferAccountId} onChange={(event) => setTransferAccountId(event.target.value)} required><option value="" disabled>เลือกบัญชีปลายทาง</option>{accounts.filter((account) => account.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></> : <><label>หมวดหมู่<input value={category} onChange={(event) => setCategory(event.target.value)} required /></label><label>บัญชี<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></>}</div>{type === 'transfer' ? <div className="two-field-row"><label>หมวดหมู่<input value={category} onChange={(event) => setCategory(event.target.value)} required /></label><label>วันที่<input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /></label></div> : <label>วันที่<input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /></label>}<label>รายละเอียด<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="เช่น มื้อกลางวัน" /></label><button className="primary-button modal-submit" disabled={saving || !accounts.length || (type === 'transfer' && !transferAccountId)}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{slipReview ? 'ยืนยันและบันทึกรายการ' : 'บันทึกรายการ'}</button></form>}</section></div>
}
