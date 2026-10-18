import { ArrowRight, ArrowLeft, ArrowDownLeft, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, jsonBody } from '../api'
import { APP_VERSION } from '../lib/format'

export function AuthScreen({ onSubmit, loading, notice }: { onSubmit: (email: string, password: string, register: boolean) => void; loading: boolean; notice: string }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'login' || mode === 'register') {
      onSubmit(email, password, mode === 'register')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      if (mode === 'forgot') {
        const result = await api<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: jsonBody({ email }) })
        setStatus(result.message)
        setMode('reset')
      } else {
        const result = await api<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: jsonBody({ email, code: otp, password }) })
        setStatus(result.message)
        setPassword('')
        setOtp('')
        setMode('login')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function changeMode(next: 'login' | 'register' | 'forgot' | 'reset') {
    setStatus('')
    setMode(next)
  }

  const heading = mode === 'register' ? 'เริ่มต้นได้เลย' : mode === 'forgot' ? 'ลืมรหัสผ่าน' : mode === 'reset' ? 'ตั้งรหัสผ่านใหม่' : 'ยินดีที่ได้พบกัน'
  const subtitle = mode === 'register' ? 'สร้างบัญชีเพื่อจัดการการเงินในแบบของคุณ' : mode === 'forgot' ? 'กรอกอีเมลที่ใช้สมัครเพื่อรับรหัส OTP' : mode === 'reset' ? 'กรอกรหัส OTP จากอีเมลและตั้งรหัสผ่านใหม่' : 'เข้าสู่ระบบเพื่อดูภาพรวมการเงินของคุณ'

  return <main className="auth-screen">
    <div className="auth-art"><div className="art-grid" /><div className="art-copy"><div className="brand brand-light"><span className="brand-symbol"><span /><span /><span /></span><span className="brand-name">ledgerly<span>.</span></span></div><p className="art-kicker">YOUR MONEY, IN FOCUS</p><h1>เห็นทุกการใช้จ่าย<br /><em>เข้าใจทุกการเติบโต</em></h1><p className="art-description">ภาพรวมการเงินที่ชัดเจน เริ่มต้นจากทุกวันที่คุณใช้ชีวิต</p><div className="art-illustration"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="chart-glass"><div className="chart-head"><span>ยอดเงินรวม</span><span>THB</span></div><strong>฿ 84,250<span>.00</span></strong><div className="art-chart"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div><div className="chart-foot"><i /> เติบโตต่อเนื่อง <b>+12.8%</b></div></div><div className="float-chip chip-income"><ArrowDownLeft size={16} /><span><small>รายรับเดือนนี้</small><b>+ ฿32,500</b></span></div><div className="float-chip chip-ai"><Sparkles size={15} /><span>AI จัดหมวดหมู่ให้แล้ว</span></div></div><div className="art-footer"><span>01 / 03</span><span className="art-progress"><i /></span><span>การเงินที่เรียบง่าย</span></div></div></div>
    <div className="auth-form-side"><div className="auth-form-wrap">
      <div className="auth-mobile-brand"><span className="brand-symbol"><span /><span /><span /></span><span className="brand-name">ledgerly<span>.</span></span></div>
      <div className="auth-eyebrow"><span /> FINANCIAL WELLNESS, REIMAGINED · {APP_VERSION}</div>
      <h2>{heading}</h2><p className="auth-subtitle">{subtitle}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>อีเมล<div className="field-with-icon"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required disabled={mode === 'reset'} /></div></label>
        {mode === 'reset' && <label>รหัส OTP<div className="field-with-icon"><LockKeyhole size={17} /><input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="รหัส 6 หลัก" minLength={6} maxLength={6} required /></div></label>}
        {(mode === 'login' || mode === 'register' || mode === 'reset') && <label>{mode === 'reset' ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'}<div className="field-with-icon"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /><button className="password-toggle" type="button" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {mode === 'login' && <button type="button" className="auth-forgot" onClick={() => changeMode('forgot')}>ลืมรหัสผ่าน?</button>}
        <button className="primary-button auth-submit" disabled={loading || busy}>{loading || busy ? <LoaderCircle size={17} className="spin" /> : null}{mode === 'register' ? 'สร้างบัญชี' : mode === 'forgot' ? 'ส่งรหัส OTP' : mode === 'reset' ? 'ตั้งรหัสผ่านใหม่' : 'เข้าสู่ระบบ'}<ArrowRight size={17} /></button>
      </form>
      {(mode === 'forgot' || mode === 'reset') && <button type="button" className="auth-back" onClick={() => changeMode('login')}><ArrowLeft size={14} /> กลับเข้าสู่ระบบ</button>}
      {mode === 'reset' && <button type="button" className="auth-resend" onClick={() => changeMode('forgot')}>ขอ OTP ใหม่</button>}
      {(mode === 'login' || mode === 'register') && <div className="auth-switch">{mode === 'register' ? 'มีบัญชีอยู่แล้ว?' : 'ยังไม่มีบัญชี?'} <button onClick={() => changeMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button></div>}
      {(status || notice) && <div className="auth-notice">{status || notice}</div>}
      <div className="auth-note"><ShieldCheck size={16} /> เข้ารหัสข้อมูลและแยกพื้นที่ส่วนตัวของคุณ</div>
    </div><div className="auth-legal"><span>© 2026 Ledgerly</span><span>นโยบายความเป็นส่วนตัว</span></div></div>
  </main>
}
