export const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export type AllowedImageMime = typeof ALLOWED_IMAGE_MIMES[number]

export function isAllowedImageMime(mime: string | null | undefined): mime is AllowedImageMime {
  return typeof mime === 'string' && (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)
}

export function detectImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (!bytes || bytes.length < 12) return null

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
    && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
  ) {
    return 'image/png'
  }

  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  // HEIC: offset 4 is 'ftyp', offset 8 is brand
  const ftyp = String.fromCharCode(...bytes.subarray(4, 8))
  if (ftyp === 'ftyp') {
    const brand = String.fromCharCode(...bytes.subarray(8, 12)).toLowerCase()
    const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']
    if (heicBrands.includes(brand)) {
      return 'image/heic'
    }
  }

  return null
}

export function getReceiptResponseHeaders(storedMime?: string | null): Record<string, string> {
  const contentType = isAllowedImageMime(storedMime) ? storedMime : 'application/octet-stream'
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  }
}
