import { describe, expect, it } from 'vitest'
import { signedAmount, toBaht, toSatang } from '../src/lib/money'

describe('toSatang', () => {
  it('converts common baht amounts to exact satang', () => {
    expect(toSatang(10.1)).toBe(1010)
    expect(toSatang(20.2)).toBe(2020)
    expect(toSatang(0.1)).toBe(10)
    expect(toSatang(0.01)).toBe(1)
    expect(toSatang(1234.55)).toBe(123455)
    expect(toSatang(350)).toBe(35000)
  })

  it('rounds half a satang to the nearest unit', () => {
    expect(toSatang(0.005)).toBe(1)
    expect(toSatang(0.015)).toBe(2)
    expect(toSatang(123.995)).toBe(12400)
  })

  it('stays an integer for floating point noise', () => {
    expect(Number.isInteger(toSatang(79.99999999999999))).toBe(true)
  })

  it('keeps negative opening balances exact', () => {
    expect(toSatang(-50.5)).toBe(-5050)
  })

  it('stays an integer for floating point noise', () => {
    expect(toSatang(10.10 + 20.20)).toBe(3030)
  })
})

describe('toBaht', () => {
  it('inverts toSatang exactly', () => {
    expect(toBaht(1010)).toBe(10.1)
    expect(toBaht(9975)).toBe(99.75)
    expect(toBaht(0)).toBe(0)
    expect(toBaht(-5050)).toBe(-50.5)
  })

  it('makes satang addition exact: 10.10 + 20.20 = 30.30', () => {
    expect(toBaht(toSatang(10.1) + toSatang(20.2))).toBe(30.3)
  })
})

describe('signedAmount', () => {
  it('income adds, everything else subtracts', () => {
    expect(signedAmount('income', 1010)).toBe(1010)
    expect(signedAmount('expense', 1010)).toBe(-1010)
    expect(signedAmount('transfer', 1010)).toBe(-1010)
  })
})
