import { Check, LoaderCircle, LockKeyhole, Mail, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api, jsonBody } from '../api'

export function AdminPage({ currentUserId, adminEmail, notify }: { currentUserId: string; adminEmail: string; notify: (message: string) => void }) {
  const [users, setUsers] = useState<Array<{ id: string; email: string; role: string; is_active: number; created_at: string }>>([])
  const [settings, setSettings] = useState<Record<string, string | boolean>>({})
  const [apiKey, setApiKey] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => Promise.all([api<{ results: typeof users }>('/api/admin/users'), api<Record<string, string | boolean>>('/api/admin/settings')]).then(([userResult, config]) => { setUsers(userResult.results); setSettings(config) }).catch((error) => notify(error.message))
  useEffect(() => { load() }, [])
  const update = async (id: string, values: { role?: string; is_active?: boolean }) => {
    try { await api(`/api/admin/users/${id}`, { method: 'PATCH', body: jsonBody(values) }); await load(); notify('อัปเดตผู้ใช้แล้ว') }
    catch (error) { notify(error instanceof Error ? error.message : 'อัปเดตไม่สำเร็จ') }
  }
  async function loadModels() {
    setModelsBusy(true)
    setModelsError('')
    try {
      const result = await api<{ models: string[] }>('/api/admin/ai/models', { method: 'POST', body: jsonBody({ base_url: String(settings.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai'), ...(apiKey ? { api_key: apiKey } : {}) }) })
      setModels(result.models)
      if (!result.models.length) setModelsError('ไม่พบโมเดลจาก base URL นี้')
      else if (!result.models.includes(String(settings.ai_model || ''))) setSettings((current) => ({ ...current, ai_model: result.models[0] }))
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'โหลดโมเดลไม่สำเร็จ')
    } finally {
      setModelsBusy(false)
    }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api('/api/admin/settings', { method: 'PUT', body: jsonBody({ ai_provider: 'openai-compatible', ai_base_url: String(settings.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai'), ai_model: settings.ai_model || 'gemini-3.5-flash-lite', ...(apiKey ? { ai_api_key: apiKey } : {}), image_retention_policy: settings.image_retention_policy || 'auto_cleanup', image_retention_days: String(settings.image_retention_days || '90'), registration_open: String(settings.registration_open ?? '1'), smtp_from_email: settings.smtp_from_email || '', ...(smtpPassword ? { smtp_app_password: smtpPassword.replaceAll(' ', '') } : {}) }) })
      setApiKey('')
      setSmtpPassword('')
      await load()
      notify('บันทึกการตั้งค่าระบบแล้ว')
    }
    catch (error) { notify(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  async function sendTestEmail() {
    setTestingEmail(true)
    try { await api('/api/admin/settings/test-email', { method: 'POST', body: jsonBody({}) }); notify(`ส่งอีเมลทดสอบไปที่ ${adminEmail} แล้ว`) }
    catch (error) { notify(error instanceof Error ? error.message : 'ส่งอีเมลทดสอบไม่สำเร็จ') }
    finally { setTestingEmail(false) }
  }
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">SYSTEM CONTROL</p><h1>จัดการระบบ</h1><p className="heading-sub">ผู้ใช้ การประมวลผล AI อีเมล OTP และนโยบายรูปภาพ</p></div><span className="admin-badge"><ShieldCheck size={15} /> ผู้ดูแลระบบ</span></div>
    <div className="admin-layout">
      <section className="admin-section"><div className="admin-section-head"><div><span className="section-kicker">ACCESS CONTROL</span><h2>ผู้ใช้งาน <span className="count-pill">{users.length}</span></h2></div><button className="outline-small" onClick={() => load()}>รีเฟรช</button></div><div className="admin-users">{users.map((item) => <div className="admin-user-row" key={item.id}><span className="avatar">{item.email[0].toUpperCase()}</span><span className="profile-copy"><b>{item.email}</b><small>{new Date(item.created_at).toLocaleDateString('th-TH')}</small></span><select aria-label="สิทธิ์ผู้ใช้" title={item.id === currentUserId ? 'ไม่สามารถเปลี่ยนบทบาทบัญชีตัวเองได้' : 'เปลี่ยนสิทธิ์ผู้ใช้'} disabled={item.id === currentUserId} value={item.role} onChange={(event) => update(item.id, { role: event.target.value })}><option value="user">ผู้ใช้</option><option value="admin">ผู้ดูแล</option></select><button className={`status-pill ${item.is_active ? 'enabled' : 'disabled'}`} disabled={item.id === currentUserId} title={item.id === currentUserId ? 'ไม่สามารถปิดใช้งานบัญชีตัวเองได้' : ''} onClick={() => update(item.id, { is_active: !item.is_active })}>{item.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</button></div>)}</div></section>
      <form className="admin-section admin-config" onSubmit={saveSettings}>
        <div className="admin-section-head"><div><span className="section-kicker">AI & STORAGE POLICY</span><h2>การตั้งค่าระบบ</h2></div><Sparkles size={19} /></div>
        <label>การเปิดรับสมัครสมาชิก<select value={String(settings.registration_open ?? '1')} onChange={(event) => setSettings({ ...settings, registration_open: event.target.value })}><option value="1">เปิดรับสมัคร (ปกติ)</option><option value="0">ปิดรับสมัครชั่วคราว</option></select></label>
        <label>AI base URL<input type="url" placeholder="https://generativelanguage.googleapis.com/v1beta/openai" value={String(settings.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai')} onChange={(event) => setSettings({ ...settings, ai_base_url: event.target.value })} /></label>
        <label>AI API Key<input type="password" placeholder={settings.ai_key_set ? 'ตั้งค่าแล้ว · เว้นว่างเพื่อใช้ค่าเดิม' : 'ใส่ API Key'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
        <div className="model-picker-row"><label>โมเดล AI<select value={String(settings.ai_model || 'gemini-3.5-flash-lite')} onChange={(event) => setSettings({ ...settings, ai_model: event.target.value })}><option value={String(settings.ai_model || 'gemini-3.5-flash-lite')}>{String(settings.ai_model || 'gemini-3.5-flash-lite')}</option>{models.filter((model) => model !== String(settings.ai_model || '')).map((model) => <option key={model} value={model}>{model}</option>)}</select></label><button type="button" className="outline-small" disabled={modelsBusy} onClick={loadModels}>{modelsBusy ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />} โหลดโมเดล</button></div>
        {modelsError && <p className="model-error" role="status">{modelsError}</p>}
        <label>นโยบายเก็บรูปภาพ<select value={String(settings.image_retention_policy || 'auto_cleanup')} onChange={(event) => setSettings({ ...settings, image_retention_policy: event.target.value })}><option value="full">full · เก็บตลอดไป</option><option value="auto_cleanup">auto_cleanup · ลบตามกำหนด</option><option value="data_only">data_only · ลบทันทีหลังอ่าน</option></select></label>
        {settings.image_retention_policy !== 'full' && settings.image_retention_policy !== 'data_only' && <label>เก็บรูปเป็นเวลา (วัน)<input type="number" min="1" max="3650" value={String(settings.image_retention_days || '90')} onChange={(event) => setSettings({ ...settings, image_retention_days: event.target.value })} /></label>}
        <div className="admin-divider"><span>ตั้งค่าอีเมลส่งรหัส OTP</span></div>
        <label>Gmail สำหรับส่งอีเมล<input type="email" autoComplete="email" placeholder="ledgerly@gmail.com" value={String(settings.smtp_from_email || '')} onChange={(event) => setSettings({ ...settings, smtp_from_email: event.target.value })} /></label>
        <label>Gmail App Password<input type="password" autoComplete="new-password" placeholder={settings.smtp_app_password_set ? 'ตั้งค่าแล้ว · เว้นว่างเพื่อใช้ค่าเดิม' : 'App Password 16 หลัก'} value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value.replaceAll(' ', ''))} /></label>
        <p className="field-hint"><LockKeyhole size={13} /> App Password ถูกเข้ารหัส AES-256-GCM ก่อนจัดเก็บ</p>
        <div className="admin-action-row"><button type="button" className="outline-small" disabled={testingEmail || !settings.smtp_from_email || !settings.smtp_app_password_set} onClick={sendTestEmail}>{testingEmail ? <LoaderCircle size={13} className="spin" /> : <Mail size={13} />} ส่งอีเมลทดสอบไปยังบัญชีนี้</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} บันทึกการตั้งค่า</button></div>
      </form>
    </div>
  </section>
}
