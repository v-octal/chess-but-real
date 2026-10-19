import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatRoomCode, makeRoomCode, normalizeRoomCode, playLink } from './relay'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('short friend codes', () => {
  it.each(['/', '/chess-but-real/', '/games/chess-royale/'])('preserves the deployment path %s in a play link', path => {
    const href = `https://player.github.io${path}?theme=sage#join/old-invite`
    vi.stubGlobal('location', new URL(href))
    const code = 'K7QXM2P4'
    const link = playLink(code)
    expect(link).toBe(`https://player.github.io${path}?theme=sage#play/${code}`)
    expect(normalizeRoomCode(link)).toBe(code)
    expect(location.href).toBe(href)
  })

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
