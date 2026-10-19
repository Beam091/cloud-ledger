import { describe, expect, it } from 'vitest'
import { detectImageMime, isAllowedImageMime } from '../src/lib/images'

describe('detectImageMime', () => {
  it('detects JPEG from magic bytes', () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1])
    expect(detectImageMime(bytes)).toBe('image/jpeg')
  })

  it('detects PNG from magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
    expect(detectImageMime(bytes)).toBe('image/png')
  })

  it('detects WebP from RIFF and WEBP signatures', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(detectImageMime(bytes)).toBe('image/webp')
  })

  it('detects HEIC from ftyp box and compatible brands', () => {
    const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
    expect(detectImageMime(bytes)).toBe('image/heic')
  })

  it('rejects SVG and other XML/HTML files', () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(detectImageMime(svgBytes)).toBeNull()

    const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>Test</body></html>')
    expect(detectImageMime(htmlBytes)).toBeNull()
  })

  it('rejects short or corrupted byte sequences', () => {
    expect(detectImageMime(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(detectImageMime(new Uint8Array(0))).toBeNull()
  })
})

describe('isAllowedImageMime', () => {
  it('allows only allowed MIME types', () => {
    expect(isAllowedImageMime('image/jpeg')).toBe(true)
    expect(isAllowedImageMime('image/png')).toBe(true)
    expect(isAllowedImageMime('image/webp')).toBe(true)
    expect(isAllowedImageMime('image/heic')).toBe(true)

    expect(isAllowedImageMime('image/svg+xml')).toBe(false)
    expect(isAllowedImageMime('image/gif')).toBe(false)
    expect(isAllowedImageMime('text/html')).toBe(false)
    expect(isAllowedImageMime(null)).toBe(false)
    expect(isAllowedImageMime(undefined)).toBe(false)
  })
})
