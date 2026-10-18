import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '../lib/format'

// Loaded lazily so recharts stays out of the initial bundle
export default function SpendChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 12, right: 4, left: -22, bottom: 0 }}>
      <defs><linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c987f" stopOpacity={0.28} /><stop offset="100%" stopColor="#7c987f" stopOpacity={0.01} /></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="#e9ebe5" strokeDasharray="3 5" />
      <XAxis dataKey="name" interval={Math.max(0, Math.floor(data.length / 5))} axisLine={false} tickLine={false} tick={{ fill: '#899087', fontSize: 10 }} tickMargin={9} />
      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#a0a69c', fontSize: 10 }} tickFormatter={(value) => value >= 1000 ? `${value / 1000}k` : value} />
      <Tooltip formatter={(value) => [`฿${money(Number(value))}`, 'รายจ่าย']} contentStyle={{ border: '1px solid #e7e9e2', borderRadius: 8, fontSize: 12 }} />
      <Area type="monotone" dataKey="value" stroke="#68836c" strokeWidth={2.5} fill="url(#spendFill)" />
    </AreaChart>
  </ResponsiveContainer>
}
