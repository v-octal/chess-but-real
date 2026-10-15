import { describe, expect, it } from 'vitest'
import { formatRoomCode, makeRoomCode, normalizeRoomCode } from './relay'

describe('short friend codes', () => {
  it('makes a readable eight-character code', () => {
    const code = makeRoomCode()
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
    expect(formatRoomCode(code)).toMatch(/^.{4}-.{4}$/)
  })

  it('reads a code from typed text or a shared link', () => {
    expect(normalizeRoomCode('k7qx-m2p4')).toBe('K7QXM2P4')
    expect(normalizeRoomCode(' K7QX M2P4 ')).toBe('K7QXM2P4')
    expect(normalizeRoomCode('https://player.github.io/chess/#play/K7QXM2P4')).toBe('K7QXM2P4')
  })

  it('rejects a code with a wrong length or an ambiguous letter', () => {
    expect(normalizeRoomCode('K7QX')).toBeNull()
    expect(normalizeRoomCode('K7QXM2P0')).toBeNull()
    expect(normalizeRoomCode('K7QXM2PI')).toBeNull()
  })
})
