import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const fontPath = path.join(process.cwd(), 'public/fonts/material-symbols-savingkc.ttf')
const REQUIRED = ['today', 'routine', 'manage_search', 'playlist_remove', 'home', 'settings', 'campaign', 'chevron_left']

function u16(buf: Buffer, offset: number) {
  return buf.readUInt16BE(offset)
}

function u32(buf: Buffer, offset: number) {
  return buf.readUInt32BE(offset)
}

function table(buf: Buffer, tag: string) {
  const count = u16(buf, 4)
  for (let index = 0; index < count; index += 1) {
    const offset = 12 + index * 16
    if (buf.toString('latin1', offset, offset + 4) === tag) {
      return u32(buf, offset + 8)
    }
  }
  throw new Error(`missing ${tag} table`)
}

function cmap(buf: Buffer) {
  const start = table(buf, 'cmap')
  const records = u16(buf, start + 2)
  let subtable = 0
  for (let index = 0; index < records; index += 1) {
    const offset = start + 4 + index * 8
    const platform = u16(buf, offset)
    const encoding = u16(buf, offset + 2)
    const location = start + u32(buf, offset + 4)
    if ((platform === 3 && encoding === 1) || platform === 0) subtable = location
  }
  if (u16(buf, subtable) !== 4) throw new Error('expected cmap format 4')
  const segCount = u16(buf, subtable + 6) / 2
  const endCode = subtable + 14
  const startCode = endCode + segCount * 2 + 2
  const idDelta = startCode + segCount * 2
  const idRangeOffset = idDelta + segCount * 2
  const map = new Map<number, number>()
  for (let index = 0; index < segCount; index += 1) {
    const end = u16(buf, endCode + index * 2)
    const startAt = u16(buf, startCode + index * 2)
    const delta = buf.readInt16BE(idDelta + index * 2)
    const rangeOffset = u16(buf, idRangeOffset + index * 2)
    for (let code = startAt; code <= end; code += 1) {
      let glyph = 0
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff
      else {
        const glyphOffset = idRangeOffset + index * 2 + rangeOffset + (code - startAt) * 2
        glyph = u16(buf, glyphOffset)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) map.set(code, glyph)
    }
  }
  return map
}

function ligatures(buf: Buffer, characters: Map<number, number>) {
  const byGlyph = new Map<number, string>()
  for (const [code, glyph] of characters) byGlyph.set(glyph, String.fromCharCode(code))
  const gsub = table(buf, 'GSUB')
  const lookupList = gsub + u16(buf, gsub + 8)
  const lookupCount = u16(buf, lookupList)
  const names = new Set<string>()
  const readLigatureLookup = (lookup: number) => {
    if (u16(buf, lookup) !== 1) return
    const coverage = lookup + u16(buf, lookup + 2)
    const setCount = u16(buf, lookup + 4)
    const firstGlyphs: number[] = []
    const coverageFormat = u16(buf, coverage)
    if (coverageFormat === 1) {
      const glyphCount = u16(buf, coverage + 2)
      for (let index = 0; index < glyphCount; index += 1) firstGlyphs.push(u16(buf, coverage + 4 + index * 2))
    } else if (coverageFormat === 2) {
      const rangeCount = u16(buf, coverage + 2)
      for (let index = 0; index < rangeCount; index += 1) {
        const record = coverage + 4 + index * 6
        const startGlyph = u16(buf, record)
        const endGlyph = u16(buf, record + 2)
        const startCoverage = u16(buf, record + 4)
        for (let glyph = startGlyph; glyph <= endGlyph; glyph += 1) firstGlyphs[startCoverage + glyph - startGlyph] = glyph
      }
    }
    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      const set = lookup + u16(buf, lookup + 6 + setIndex * 2)
      const ligCount = u16(buf, set)
      for (let ligIndex = 0; ligIndex < ligCount; ligIndex += 1) {
        const lig = set + u16(buf, set + 2 + ligIndex * 2)
        const componentCount = u16(buf, lig + 2)
        const chars = [byGlyph.get(firstGlyphs[setIndex] ?? -1) ?? '']
        for (let component = 0; component < componentCount - 1; component += 1) {
          chars.push(byGlyph.get(u16(buf, lig + 4 + component * 2)) ?? '')
        }
        names.add(chars.join(''))
      }
    }
  }
  for (let lookupIndex = 0; lookupIndex < lookupCount; lookupIndex += 1) {
    const lookup = lookupList + u16(buf, lookupList + 2 + lookupIndex * 2)
    const lookupType = u16(buf, lookup)
    const subtableCount = u16(buf, lookup + 4)
    for (let subtableIndex = 0; subtableIndex < subtableCount; subtableIndex += 1) {
      const subtable = lookup + u16(buf, lookup + 6 + subtableIndex * 2)
      if (lookupType === 7) {
        if (u16(buf, subtable + 2) !== 4) continue
        readLigatureLookup(subtable + u32(buf, subtable + 4))
      } else if (lookupType === 4) {
        readLigatureLookup(subtable)
      }
    }
  }
  return names
}

describe('material symbols subset', () => {
  it('keeps the used icon ligatures under the font budget and does not draw Latin letters', () => {
    const bytes = statSync(fontPath).size
    expect(bytes).toBeLessThanOrEqual(75 * 1024)
    const buf = readFileSync(fontPath)
    const names = ligatures(buf, cmap(buf))
    for (const name of REQUIRED) expect(names.has(name)).toBe(true)
    expect(names.has('scroll')).toBe(false)
  })
})
