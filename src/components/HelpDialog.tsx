import { ArrowRight, Bell, Settings2, Wallet, X } from 'lucide-react'
import type { Page } from '../types'

export function HelpDialog({ onClose, onNavigate, isAdmin }: { onClose: () => void; onNavigate: (page: Page) => void; isAdmin: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <div className="modal-head"><div><span className="section-kicker">LEDGERLY HELP</span><h2 id="help-title">ศูนย์ช่วยเหลือ</h2></div><button className="icon-button" aria-label="ปิด" onClick={onClose}><X size={19} /></button></div>
    <p className="help-dialog-copy">เลือกส่วนที่ต้องการจัดการได้เลย หากมีปัญหาเกี่ยวกับการเข้าใช้ กรุณาติดต่อผู้ดูแลระบบของ workspace นี้</p>
    <div className="help-options"><button onClick={() => onNavigate('accounts')}><Wallet size={17} /><span><b>บัญชีการเงิน</b><small>เพิ่ม แก้ไข หรือตรวจยอดบัญชี</small></span><ArrowRight size={15} /></button><button onClick={() => onNavigate('settings')}><Bell size={17} /><span><b>การแจ้งเตือน</b><small>เลือกช่องทางและเวลาส่งสรุป</small></span><ArrowRight size={15} /></button>{isAdmin && <button onClick={() => onNavigate('admin')}><Settings2 size={17} /><span><b>การตั้งค่าระบบ</b><small>AI, Gmail sender และนโยบายรูปภาพ</small></span><ArrowRight size={15} /></button>}</div>
  </section></div>
}
