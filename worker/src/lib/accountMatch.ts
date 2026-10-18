export function normalizeAccountName(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-_./()]+/g, '')
    .replace(/[^a-z0-9\u0E01-\u0E5B]/g, '')
}

const bankNameAliases: Record<string, string[]> = {
  'กรุงไทย': ['ktb', 'krungthai', 'kbank', 'krungthai bank'],
  'กสิกรไทย': ['kasikorn', 'kbankthai', 'kasikornbank'],
  'ไทยพาณิชย์': ['scb', 'siamcommercialbank', 'thairath'],
  'ทหารไทย': ['tmb', 'ttb', 'thanachart', 'tmbbank'],
  'กรุงเทพ': ['bangkokbank', 'bbl'],
  'ออมสิน': ['gsb', 'governmentsavingbank'],
  'true money': ['truemoney', 'truemoneywallet', 'truewallet'],
  'e-wallet': ['ewallet', 'wallet', 'วอลเล็ต', 'วอเลต', 'วอลเล็ท', 'กระเป๋าเงินออนไลน์'],
  'promptpay': ['promptpay', 'พร้อมเพย์'],
  'cash': ['เงินสด', 'cash'],
}

export function accountAliasVariants(value: string) {
  const variants = new Set<string>([normalizeAccountName(value)])
  const normalized = normalizeAccountName(value)
  for (const [canonical, aliases] of Object.entries(bankNameAliases)) {
    const normalizedCanonical = normalizeAccountName(canonical)
    if (!normalizedCanonical) continue
    if (normalized === normalizedCanonical || aliases.some((alias) => normalizeAccountName(alias) === normalized)) {
      variants.add(normalizedCanonical)
      for (const alias of [canonical, ...aliases]) variants.add(normalizeAccountName(alias))
    }
  }
  return [...variants].filter(Boolean)
}

export function scoreAccountMatch(inputName: string, accountName: string) {
  const input = normalizeAccountName(inputName)
  const account = normalizeAccountName(accountName)
  if (!input || !account) return 0
  if (input === account) return 100

  const inputVariants = accountAliasVariants(inputName)
  const accountVariants = accountAliasVariants(accountName)
  if (inputVariants.some((variant) => accountVariants.includes(variant))) return 90

  if (account.includes(input) || input.includes(account)) return 75

  const shortInput = input.slice(0, 3)
  const shortAccount = account.slice(0, 3)
  if (shortInput && shortAccount && (account.includes(shortInput) || input.includes(shortAccount))) return 40

  return 0
}
