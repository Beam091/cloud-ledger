import { describe, expect, it } from 'vitest'
import { accountAliasVariants, normalizeAccountName, scoreAccountMatch } from '../src/lib/accountMatch'

describe('normalizeAccountName', () => {
  it('trims separators and lowercases', () => {
    expect(normalizeAccountName(' กสิกรไทย-01 ')).toBe('กสิกรไทย01')
    expect(normalizeAccountName('True Money Wallet')).toBe('truemoneywallet')
    expect(normalizeAccountName('KTB / main')).toBe('ktbmain')
  })

  it('collapses empty values', () => {
    expect(normalizeAccountName('   ')).toBe('')
  })
})

describe('accountAliasVariants', () => {
  it('expands bank aliases in both directions', () => {
    const krungthai = accountAliasVariants('กรุงไทย')
    expect(krungthai).toContain('ktb')
    expect(krungthai).toContain('krungthai')

    const ktb = accountAliasVariants('KTB')
    expect(ktb).toContain('กรุงไทย')
  })

  it('returns only the normalized form for unknown names', () => {
    expect(accountAliasVariants('mybank')).toEqual(['mybank'])
  })
})

describe('scoreAccountMatch', () => {
  it('exact match wins', () => {
    expect(scoreAccountMatch('TrueMoney', 'truemoney')).toBe(100)
    expect(scoreAccountMatch('เงินสด', 'เงินสด')).toBe(100)
  })

  it('bank alias scores high', () => {
    expect(scoreAccountMatch('KTB', 'กรุงไทย')).toBe(90)
    expect(scoreAccountMatch('truewallet', 'true money')).toBe(90)
    expect(scoreAccountMatch('scb', 'ไทยพาณิชย์')).toBe(90)
  })

  it('substring containment scores mid-range', () => {
    expect(scoreAccountMatch('sondap', 'sondapspring')).toBe(75)
    expect(scoreAccountMatch('mainwallet', 'mywallet')).toBe(0)
  })

  it('short prefix scores low', () => {
    expect(scoreAccountMatch('abc2000', 'abcreature')).toBe(40)
  })

  it('unrelated names score zero', () => {
    expect(scoreAccountMatch('mybankcard', 'myaccount')).toBe(0)
    expect(scoreAccountMatch('', 'bank')).toBe(0)
  })
})
