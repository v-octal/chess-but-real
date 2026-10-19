import { afterEach, describe, expect, it, vi } from 'vitest'
import { Chess } from 'chess.js'
import { resolveMove } from './capture'
import { decodeSignal, encodeSignal, extractCode, inviteLink, parseMessage } from './pvp'

const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('friend link codes', () => {
  it.each(['/', '/chess-but-real/', '/games/chess-royale/'])('preserves the deployment path %s in an invite link', async path => {
    const href = `https://player.github.io${path}?theme=sage#play/OLDROOM`
    vi.stubGlobal('location', new URL(href))
    const signal = { v: 1, t: 'o', s: sdp, c: 'w', m: 0, g: 'game-pages' } as const
    const code = await encodeSignal(signal)
    const link = inviteLink(code)
    expect(link).toBe(`https://player.github.io${path}?theme=sage#join/${code}`)
    expect(extractCode(link)).toBe(code)
    expect(await decodeSignal(link)).toEqual(signal)
    expect(location.href).toBe(href)
  })

  it('keeps an invite and a reply intact', async () => {
    const invite = await encodeSignal({ v: 1, t: 'o', s: sdp, c: 'b', m: 0, g: 'game-1' })
    const reply = await encodeSignal({ v: 1, t: 'a', s: sdp, g: 'game-1' })
    expect(invite.startsWith('cc1')).toBe(true)
    expect(await decodeSignal(invite)).toMatchObject({ t: 'o', c: 'b', m: 0, g: 'game-1', s: sdp })
    expect(await decodeSignal(`https://player.github.io/chess/#join/${invite}`)).toMatchObject({ t: 'o', g: 'game-1' })
    expect(await decodeSignal(reply)).toMatchObject({ t: 'a', s: sdp })
  })

  it('reads a code from a shared link and rejects a bad code', async () => {
    const invite = await encodeSignal({ v: 1, t: 'o', s: sdp, c: 'w', m: 1, g: 'game-2' })
    expect(extractCode(`Please open ${inviteLinkSafe(invite)} thanks`)).toBe(invite)
    await expect(decodeSignal('not-a-link')).rejects.toThrow('This link is not valid.')
  })
})

describe('friend messages', () => {
  it('accepts legal game messages and rejects bad data', () => {
    expect(parseMessage(JSON.stringify({ type: 'move', from: 'e2', to: 'e4' }))).toMatchObject({ from: 'e2', to: 'e4' })
    expect(parseMessage(JSON.stringify({ type: 'move', from: 'e2', to: 'e9' }))).toBeNull()
    expect(parseMessage(JSON.stringify({ type: 'resign', color: 'w' }))?.type).toBe('resign')
    expect(parseMessage(JSON.stringify({ type: 'draw', accept: false }))).toMatchObject({ accept: false })
    expect(parseMessage('{"type":"hack"}')).toBeNull()
    expect(parseMessage('nope')).toBeNull()
  })

  it('accepts one shared capture roll and rejects invalid rolls', () => {
    const move = { type: 'move', from: 'e4', to: 'd5', before: 'position' }
    for (const roll of [0, 0.7, 0.999999]) {
      expect(parseMessage(JSON.stringify({ ...move, roll }))).toMatchObject({ roll })
    }
    for (const roll of [-0.1, 1, '0.5', null]) {
      expect(parseMessage(JSON.stringify({ ...move, roll }))).toBeNull()
    }
    expect(parseMessage(JSON.stringify({ ...move, before: 4 }))).toBeNull()
  })
})

describe('deterministic battle messages', () => {
  const start = { type: 'battle-start', version: 2, gameId: 'game-1', hostColor: 'w' } as const
  const action = { type: 'battle-action', version: 2, gameId: 'game-1', ply: 0, from: 'e2', to: 'e4', before: JSON.stringify({ ply: 0 }) } as const
  const resign = { type: 'battle-resign', version: 2, gameId: 'game-1', ply: 1, color: 'b' } as const
  const messages = [start, action, resign]

  it.each(messages)('accepts $type', message => {
    expect(parseMessage(JSON.stringify(message))).toStrictEqual(message)
  })

  it.each(messages)('rejects invalid versions for $type', message => {
    for (const version of [undefined, null, 1, 3, '2', true]) {
      expect(parseMessage(JSON.stringify({ ...message, version }))).toBeNull()
    }
  })

  it.each(messages)('checks game ID limits for $type', message => {
    for (const gameId of ['g', 'g'.repeat(128)]) {
      expect(parseMessage(JSON.stringify({ ...message, gameId }))).toStrictEqual({ ...message, gameId })
    }
    for (const gameId of [undefined, null, '', 'g'.repeat(129), 1, true, {}]) {
      expect(parseMessage(JSON.stringify({ ...message, gameId }))).toBeNull()
    }
  })

  it.each(messages)('does not pass peer state in $type', message => {
    expect(parseMessage(JSON.stringify({ ...message, state: { ply: 99 }, fen: 'peer position', roll: 0.5 }))).toStrictEqual(message)
  })

  it.each([action, resign])('checks safe nonnegative ply for $type', message => {
    for (const ply of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(parseMessage(JSON.stringify({ ...message, ply }))).toStrictEqual({ ...message, ply })
    }
    for (const ply of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '0', true]) {
      expect(parseMessage(JSON.stringify({ ...message, ply }))).toBeNull()
    }
  })

  it.each(['w', 'b'])('accepts battle colors %s', color => {
    expect(parseMessage(JSON.stringify({ ...start, hostColor: color }))).toStrictEqual({ ...start, hostColor: color })
    expect(parseMessage(JSON.stringify({ ...resign, color }))).toStrictEqual({ ...resign, color })
  })

  it.each([undefined, null, '', 'white', 'W', 1, true])('rejects invalid battle colors %s', color => {
    expect(parseMessage(JSON.stringify({ ...start, hostColor: color }))).toBeNull()
    expect(parseMessage(JSON.stringify({ ...resign, color }))).toBeNull()
  })

  it.each(['from', 'to'])('checks the action square %s', field => {
    for (const square of ['a1', 'h8']) {
      expect(parseMessage(JSON.stringify({ ...action, [field]: square }))).toStrictEqual({ ...action, [field]: square })
    }
    for (const square of [undefined, null, '', 'e9', 'i2', 'E2', 'e2e4', 2, true]) {
      expect(parseMessage(JSON.stringify({ ...action, [field]: square }))).toBeNull()
    }
  })

  it('checks optional action promotions', () => {
    for (const promotion of ['q', 'r', 'b', 'n']) {
      const message = { ...action, from: 'a7', to: 'a8', promotion }
      expect(parseMessage(JSON.stringify(message))).toStrictEqual(message)
    }
    for (const promotion of [null, '', 'p', 'k', 'Q', 1, true]) {
      expect(parseMessage(JSON.stringify({ ...action, promotion }))).toBeNull()
    }
  })

  it('accepts a bounded state key without a peer state', () => {
    for (const before of ['', action.before, 'x'.repeat(29999)]) {
      expect(parseMessage(JSON.stringify({ ...action, before }))).toStrictEqual({ ...action, before })
    }
    for (const before of [undefined, null, 1, true, {}, [], 'x'.repeat(30000)]) {
      expect(parseMessage(JSON.stringify({ ...action, before }))).toBeNull()
    }
  })
})

describe('shared capture outcomes', () => {
  it.each([0, 0.999999])('keeps both players in the same position with roll %s', roll => {
    const sender = new Chess('7k/8/8/4p3/3P4/8/8/K7 w - - 0 1')
    const receiver = new Chess(sender.fen())
    const before = sender.fen()
    const input = { from: 'd4', to: 'e5' }
    const local = resolveMove(sender, input, roll)
    const message = parseMessage(JSON.stringify({ type: 'move', ...input, before, roll: local.capture?.roll }))
    expect(message?.type).toBe('move')
    if (message?.type !== 'move') throw new Error('Expected a move message')
    expect(message.before).toBe(receiver.fen())
    const remote = resolveMove(receiver, message, message.roll)
    expect(remote.capture).toEqual(local.capture)
    expect(receiver.fen()).toBe(sender.fen())
    expect(receiver.pgn()).toBe(sender.pgn())
  })
})

function inviteLinkSafe(code: string) {
  return `https://player.github.io/chess/#join/${code}`
}
