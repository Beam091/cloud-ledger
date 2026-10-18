import { Check, LoaderCircle, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, jsonBody } from '../api'
import type { Account } from '../types'

export function AccountDialog({ existing, onClose, onSaved, notify }: { existing?: Account; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [name, setName] = useState(existing?.name || '')
  const [type, setType] = useState(existing?.type || 'bank')
  const [balance, setBalance] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await api(existing ? `/api/accounts/${existing.id}` : '/api/accounts', { method: existing ? 'PATCH' : 'POST', body: jsonBody(existing ? { name, type } : { name, type, balance: Number(balance || 0) }) }); onSaved() } catch (error) { notify(error instanceof Error ? error.message : 'บันทึกบัญชีไม่สำเร็จ') } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal account-modal" onSubmit={submit}><div className="modal-head"><div><span className="section-kicker">FINANCIAL ACCOUNT</span><h2>{existing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'}</h2></div><button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div><label>ชื่อบัญชี<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น ธนาคารกสิกรไทย" required /></label><label>ประเภทบัญชี<select value={type} onChange={(event) => setType(event.target.value)}><option value="bank">ธนาคาร</option><option value="e_wallet">e-Wallet</option><option value="cash">เงินสด</option><option value="other">อื่น ๆ</option></select></label>{!existing && <label>ยอดเงินเริ่มต้น<input type="number" step="0.01" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="0.00" /></label>}<button className="primary-button modal-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : existing ? <Check size={16} /> : <Plus size={16} />}{existing ? 'บันทึกการแก้ไข' : 'เพิ่มบัญชี'}</button></form></div>
}
