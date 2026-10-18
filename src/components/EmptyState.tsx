import { FileText } from 'lucide-react'

export function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><span className="empty-mark"><FileText size={18} /></span><b>{title}</b><small>{detail}</small></div> }
