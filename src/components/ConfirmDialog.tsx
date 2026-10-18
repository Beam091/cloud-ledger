import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'

export type ConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
}

// Replaces native window.confirm with an in-app dialog
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { await request.onConfirm() }
    finally { onClose() }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <div className="modal-head"><div><span className="section-kicker">กรุณายืนยัน</span><h2 id="confirm-title">{request.title}</h2></div></div>
    <p className="confirm-copy">{request.message}</p>
    <div className="confirm-actions">
      <button className="outline-button" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
      <button className="danger-button" type="button" disabled={busy} onClick={run}>{busy ? <LoaderCircle size={15} className="spin" /> : null}{request.confirmLabel || 'ยืนยัน'}</button>
    </div>
  </section></div>
}
