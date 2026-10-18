import { CreditCard, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { accountKinds, money } from '../lib/format'
import type { Account } from '../types'
import { EmptyState } from './EmptyState'

export function AccountsPage({ accounts, onAdd, onEdit, onDelete }: { accounts: Account[]; onAdd: () => void; onEdit: (account: Account) => void; onDelete: (account: Account) => void }) {
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
