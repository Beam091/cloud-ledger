// All monetary values are stored in D1 as INTEGER satang (1/100 THB); the API keeps baht decimals.
export const SATANG_PER_BAHT = 100

export function toSatang(baht: number) { return Math.round(Number(baht) * SATANG_PER_BAHT) }
export function toBaht(satang: number) { return Number(satang) / SATANG_PER_BAHT }

// Income increases the account balance; everything else decreases it.
export function signedAmount(type: string, amount: number) { return type === 'income' ? amount : -amount }
