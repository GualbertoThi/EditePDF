export type PdfFontAsset = { family: string; name: string; src: string; weight: string; style: string }

/** PDF.js fonts often map private-use characters, not Unicode. Rebuild cmap so
 * editable Unicode text uses those glyphs without replacing the actual text. */
export function unicodeFont(data: Uint8Array, characters: Map<number, number>): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint16(4)
  const tables = Array.from({ length: count }, (_, index) => {
    const offset = 12 + index * 16, start = view.getUint32(offset + 8), length = view.getUint32(offset + 12)
    return { tag: view.getUint32(offset), bytes: data.slice(start, start + length) }
  })
  const cmap = tables.find(t => t.tag === 0x636d6170)
  if (!cmap) throw new Error('Fonte sem cmap.')
  const cv = new DataView(cmap.bytes.buffer)
  const subtables = Array.from({ length: cv.getUint16(2) }, (_, i) => cv.getUint32(8 + i * 8))
  const glyph = (code: number) => {
    for (const start of subtables) {
      const format = cv.getUint16(start)
      if (format === 12) {
        for (let i = 0; i < cv.getUint32(start + 12); i++) {
          const p = start + 16 + i * 12, first = cv.getUint32(p), last = cv.getUint32(p + 4)
          if (code >= first && code <= last) return cv.getUint32(p + 8) + code - first
        }
      } else if (format === 4 && code <= 0xffff) {
        const segments = cv.getUint16(start + 6) / 2
        for (let i = 0; i < segments; i++) {
          const end = cv.getUint16(start + 14 + i * 2), begin = cv.getUint16(start + 16 + segments * 2 + i * 2)
          if (code < begin || code > end) continue
          const delta = cv.getInt16(start + 16 + segments * 4 + i * 2)
          const ro = start + 16 + segments * 6 + i * 2, range = cv.getUint16(ro)
          if (!range) return (code + delta) & 0xffff
          const id = cv.getUint16(ro + range + (code - begin) * 2)
          return id ? (id + delta) & 0xffff : 0
        }
      }
    }
    return 0
  }
  const mappings = [...characters].map(([unicode, code]) => [unicode, glyph(code)]).filter(([, id]) => id > 0).sort((a, b) => a[0] - b[0])
  if (!mappings.length) throw new Error('Fonte sem mapeamento Unicode utilizável.')
  const bytes = new Uint8Array(28 + mappings.length * 12), mapped = new DataView(bytes.buffer)
  mapped.setUint16(2, 1); mapped.setUint16(4, 3); mapped.setUint16(6, 10); mapped.setUint32(8, 12)
  mapped.setUint16(12, 12); mapped.setUint32(16, bytes.length - 12); mapped.setUint32(24, mappings.length)
  mappings.forEach(([code, id], i) => { mapped.setUint32(28 + i * 12, code); mapped.setUint32(32 + i * 12, code); mapped.setUint32(36 + i * 12, id) })
  cmap.bytes = bytes
  const align = (value: number) => Math.ceil(value / 4) * 4
  const output = new Uint8Array(12 + count * 16 + tables.reduce((sum, t) => sum + align(t.bytes.length), 0))
  output.set(data.subarray(0, 12))
  const result = new DataView(output.buffer)
  let cursor = 12 + count * 16, headOffset = 0
  const checksum = (input: Uint8Array) => {
    let sum = 0
    for (let i = 0; i < input.length; i += 4) sum = (sum + (((input[i] || 0) * 0x1000000) + ((input[i + 1] || 0) << 16) + ((input[i + 2] || 0) << 8) + (input[i + 3] || 0))) >>> 0
    return sum
  }
  tables.forEach((table, i) => {
    if (table.tag === 0x68656164) { table.bytes.fill(0, 8, 12); headOffset = cursor }
    const at = 12 + i * 16
    result.setUint32(at, table.tag); result.setUint32(at + 4, checksum(table.bytes)); result.setUint32(at + 8, cursor); result.setUint32(at + 12, table.bytes.length)
    output.set(table.bytes, cursor); cursor += align(table.bytes.length)
  })
  if (headOffset) result.setUint32(headOffset + 8, (0xb1b0afba - checksum(output)) >>> 0)
  return output
}

export function fontDataUrl(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:font/ttf;base64,${btoa(binary)}`
}

export async function loadFontAssets(assets: PdfFontAsset[]): Promise<() => void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return () => {}
  const faces: FontFace[] = []
  try {
    const results = await Promise.allSettled(assets.map(async asset => {
      const face = await new FontFace(asset.family, `url(${asset.src})`, { weight: asset.weight, style: asset.style }).load()
      document.fonts.add(face); faces.push(face)
    }))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  } catch (error) { faces.forEach(face => document.fonts.delete(face)); throw error }
  return () => faces.forEach(face => document.fonts.delete(face))
}
