import { Bell, Check, Clock3, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, jsonBody } from '../api'

const notificationScheduleOptions = [
  { label: 'รายวัน', value: '0 21 * * *' },
  { label: 'รายสัปดาห์', value: '0 21 * * 1' },
  { label: 'รายเดือน', value: '0 21 1 * *' },
]

function getNotificationScheduleLabel(value: string) {
  const cron = String(value || '0 21 * * *')
  const option = notificationScheduleOptions.find((item) => item.value === cron)
  return option?.label || 'รายวัน'
}

export function NotificationSettings({ notify }: { notify: (message: string) => void }) {
  const [form, setForm] = useState<Record<string, string | number | boolean>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Record<string, string | number | boolean>>('/api/notifications').then(setForm).catch((error) => notify(error.message)) }, [])
  const set = (key: string, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }))
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await api('/api/notifications', { method: 'PUT', body: jsonBody(form) }); notify('การตั้งค่าการแจ้งเตือนถูกบันทึกแล้ว') }
    catch (error) { notify(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  const scheduleValue = String(form.cron_schedule || '0 21 * * *')
  return <section className="page-body">
    <div className="page-heading"><div><p className="eyebrow">STAY IN THE KNOW</p><h1>การแจ้งเตือน</h1><p className="heading-sub">เลือกช่องทางและเวลารับสรุปการเงิน</p></div></div>
    <form className="settings-form" onSubmit={save}>
      <div className="settings-intro"><span className="settings-intro-icon"><Bell size={19} /></span><div><b>{getNotificationScheduleLabel(scheduleValue)}</b><p>รับภาพรวมรายรับและรายจ่ายตามเวลาที่คุณเลือก</p></div><label className="time-select"><Clock3 size={15} /><select aria-label="เลือกช่วงเวลาส่งสรุป" value={scheduleValue} onChange={(event) => set('cron_schedule', event.target.value)}><option value="0 21 * * *">รายวัน</option><option value="0 21 * * 1">รายสัปดาห์</option><option value="0 21 1 * *">รายเดือน</option></select><small>ช่วงเวลา</small></label></div>
      <div className="channel-list">
        <ChannelCard icon={<Mail size={18} />} title="Gmail" description="ส่งสรุปไปยังอีเมลผู้ใช้ของคุณ" enabled={Boolean(form.gmail_enabled)} onEnabled={(value) => set('gmail_enabled', value)}><div className="settings-fields"><p className="field-hint"><LockKeyhole size={13} /> ระบบจะส่งอีเมลไปที่บัญชีของคุณโดยอัตโนมัติ ใช้ Gmail sender ที่ผู้ดูแลระบบตั้งค่าไว้</p></div></ChannelCard>
        <ChannelCard icon={<span className="telegram-glyph">➤</span>} title="Telegram" description="รับข้อความสรุปผ่าน Telegram Bot" enabled={Boolean(form.telegram_enabled)} onEnabled={(value) => set('telegram_enabled', value)}><div className="settings-fields two-col"><label>Bot Token<input type="password" placeholder={form.telegram_token_set ? 'บันทึกไว้อย่างปลอดภัยแล้ว' : 'ใส่ token จาก BotFather'} onChange={(event) => set('telegram_bot_token', event.target.value)} /></label><label>Chat ID<input placeholder="เช่น 123456789" value={String(form.telegram_chat_id || '')} onChange={(event) => set('telegram_chat_id', event.target.value)} /></label></div></ChannelCard>
        <ChannelCard icon={<span className="discord-glyph">◉</span>} title="Discord" description="ส่ง Rich Embed ไปยังเซิร์ฟเวอร์ของคุณ" enabled={Boolean(form.discord_enabled)} onEnabled={(value) => set('discord_enabled', value)}><div className="settings-fields"><label>Webhook URL<input type="url" placeholder={form.discord_webhook_set ? 'บันทึกไว้อย่างปลอดภัยแล้ว' : 'https://discord.com/api/webhooks/...'} onChange={(event) => set('discord_webhook_url', event.target.value)} /></label></div></ChannelCard>
      </div>
      <div className="settings-save-row"><span>ตั้งค่าเขตเวลาเป็น Asia/Bangkok</span><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} บันทึกการตั้งค่า</button></div>
    </form>
  </section>
}

function ChannelCard({ icon, title, description, enabled, onEnabled, children }: { icon: ReactNode; title: string; description: string; enabled: boolean; onEnabled: (value: boolean) => void; children: ReactNode }) {
  return <article className="channel-card"><div className="channel-head"><span className={`channel-icon ${title.toLowerCase()}`}>{icon}</span><div className="channel-title"><b>{title}</b><small>{description}</small></div><label className="toggle"><input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /><span /></label></div>{enabled && <div className="channel-body">{children}</div>}</article>
}
