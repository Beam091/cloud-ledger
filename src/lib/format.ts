export const APP_VERSION = 'v1.0.10'

export const money = (amount: number) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
export const dateLabel = (value: string) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(value))
export const inputDate = (value?: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value ? new Date(value) : new Date())
export const fullDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long' }).format(new Date())
export const accountKinds: Record<string, string> = { bank: 'ธนาคาร', e_wallet: 'e-Wallet', cash: 'เงินสด', other: 'อื่น ๆ' }
export const categoryMarks: Record<string, string> = { อาหาร: 'F', เดินทาง: 'T', ช้อปปิ้ง: 'S', ที่อยู่อาศัย: 'H', สุขภาพ: 'W', รายรับ: '↗' }
