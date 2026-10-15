import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCaptureOdds, isCaptureGameOver, isCaptureRepetition, resolveMove } from './capture'

const strengths: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 4 }
const captureFen = '7k/8/8/8/p7/8/8/R3K3 w - - 0 1'
const enPassantFen = '3r3k/2p1n3/4p3/3pP3/2N5/8/8/4K3 w - d6 0 10'
const promotionFen = '1r5k/P7/8/8/8/8/8/7K w - - 0 1'
const colors: Color[] = ['w', 'b']

function legalMove(game: Chess, from: string, to: string, promotion?: string): Move {
  const move = game.moves({ verbose: true }).find((candidate) => (
    candidate.from === from && candidate.to === to && candidate.promotion === promotion
  ))
  if (!move) throw new Error('Expected a legal move')
  return move
}

function snapshot(game: Chess) {
  return {
    fen: game.fen(),
    board: game.board(),
    history: game.history(),
    pgn: game.pgn(),
    castling: { w: game.getCastlingRights('w'), b: game.getCastlingRights('b') },
  }
}

function replayHistory(game: Chess): Chess {
  const moves = game.history({ verbose: true })
  const reloaded = new Chess(moves[0]?.before ?? game.fen())
  for (const move of moves) reloaded.move(move.san === '--' ? null : move)
  return reloaded
}

function randomRoll(value = 0) {
  const random = vi.fn((array: Uint32Array) => {
    array[0] = value
    return array
  })
  vi.stubGlobal('crypto', { getRandomValues: random })
  vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected Math.random') })
  return random
}

function mirrorSquare(square: Square): Square {
  return `${square[0]}${9 - Number(square[1])}` as Square
}

function positionForColor(fen: string, color: Color): Chess {
  if (color === 'w') return new Chess(fen)
  const [board, turn, castling, ep, halfMoves, fullMoves] = fen.split(' ')
  const mirrored = board.split('/').reverse().join('/').replace(/[a-z]/gi, (piece) => (
    piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase()
  ))
  return new Chess(`${mirrored} ${turn === 'w' ? 'b' : 'w'} ${castling} ${ep === '-' ? '-' : mirrorSquare(ep as Square)} ${halfMoves} ${fullMoves}`)
}

function squaresForColor(from: Square, to: Square, color: Color) {
  return color === 'w' ? { from, to } : { from: mirrorSquare(from), to: mirrorSquare(to) }
}

function strengthPosition(piece: PieceSymbol, target: PieceSymbol, color: Color) {
  const game = new Chess('7k/8/8/8/8/8/8/7K w - - 0 1')
  const origins: Record<PieceSymbol, Square> = { p: 'a3', n: 'a2', b: 'e1', r: 'b1', q: 'b1', k: 'a3' }
  if (piece === 'k') game.remove('h1')
  game.put({ type: piece, color: 'w' }, origins[piece])
  game.put({ type: target, color: 'b' }, 'b4')
  return { game: positionForColor(game.fen(), color), ...squaresForColor(origins[piece], 'b4', color) }
}

const strengthCases = (Object.keys(strengths) as PieceSymbol[]).flatMap((piece) => (
  (['p', 'n', 'b', 'r', 'q'] as PieceSymbol[]).map((target) => ({ piece, target }))
))

const supportCases = [
  {
    name: 'the moving attacker and the victim do not count as support',
    fen: captureFen,
    from: 'a1', to: 'a4', attackers: 0, defenders: 0, strengthBonus: 12, supportBonus: 0, chance: 82,
  },
  {
    name: 'three supporters and three defenders cancel',
    fen: '7k/6b1/8/2p2n2/3p4/2P2N2/8/3R2BK w - - 0 1',
    from: 'd1', to: 'd4', attackers: 3, defenders: 3, strengthBonus: 12, supportBonus: 0, chance: 82,
  },
  {
    name: 'adjacent pawns do not count without an attack',
    fen: '7k/8/8/8/2Ppp3/8/8/3R3K w - - 0 1',
    from: 'd1', to: 'd4', attackers: 0, defenders: 0, strengthBonus: 12, supportBonus: 0, chance: 82,
  },
  {
    name: 'blocked bishops and rooks do not count',
    fen: '3r3k/8/3p4/8/3p4/8/1P6/B2R3K w - - 0 1',
    from: 'd1', to: 'd4', attackers: 0, defenders: 0, strengthBonus: 12, supportBonus: 0, chance: 82,
  },
  {
    name: 'a pinned knight counts as a supporter',
    fen: '4r2k/8/8/8/3p4/8/4N3/3RK3 w - - 0 1',
    from: 'd1', to: 'd4', attackers: 1, defenders: 0, strengthBonus: 12, supportBonus: 8, chance: 90,
  },
  {
    name: 'a pinned knight counts as a defender',
    fen: '4k3/4n3/8/3p4/8/8/8/3RR2K w - - 0 1',
    from: 'd1', to: 'd5', attackers: 0, defenders: 1, strengthBonus: 12, supportBonus: -8, chance: 74,
  },
  {
    name: 'the support bonus and the chance have upper limits',
    fen: '7k/8/8/8/3p4/2P2N2/8/3Q2BK w - - 0 1',
    from: 'd1', to: 'd4', attackers: 3, defenders: 0, strengthBonus: 15, supportBonus: 16, chance: 95,
  },
  {
    name: 'the support bonus and the chance have lower limits',
    fen: '7k/6b1/8/2p2n2/3q4/2P5/8/7K w - - 0 1',
    from: 'c3', to: 'd4', attackers: 0, defenders: 3, strengthBonus: -15, supportBonus: -16, chance: 40,
  },
  {
    name: 'a king counts as a supporter',
    fen: '7k/8/8/8/3p4/2K5/8/3R4 w - - 0 1',
    from: 'd1', to: 'd4', attackers: 1, defenders: 0, strengthBonus: 12, supportBonus: 8, chance: 90,
  },
  {
    name: 'a king counts as a defender',
    fen: '8/8/8/2k5/3p4/8/8/3R3K w - - 0 1',
    from: 'd1', to: 'd4', attackers: 0, defenders: 1, strengthBonus: 12, supportBonus: -8, chance: 74,
  },
  {
    name: 'the moving attacker blocks support from a rook behind it',
    fen: '7k/8/8/8/3p4/3R4/8/3R3K w - - 0 1',
    from: 'd3', to: 'd4', attackers: 0, defenders: 0, strengthBonus: 12, supportBonus: 0, chance: 82,
  },
  {
    name: 'en passant uses the victim square for defenders',
    fen: enPassantFen,
    from: 'e5', to: 'd6', attackers: 1, defenders: 3, strengthBonus: 0, supportBonus: -16, chance: 54,
  },
]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('getCaptureOdds', () => {
  it('returns null for a quiet move without a state change or RNG', () => {
    const random = randomRoll()
    const game = new Chess()
    const before = snapshot(game)
    expect(getCaptureOdds(game, legalMove(game, 'e2', 'e4'))).toBeNull()
    expect(snapshot(game)).toEqual(before)
    expect(random).not.toHaveBeenCalled()
  })

  describe.each(colors)('piece strength for %s', (color) => {
    it.each(strengthCases)('uses the strength of $piece against $target', ({ piece, target }) => {
      const { game, from, to } = strengthPosition(piece, target, color)
      const strengthBonus = Math.min(15, Math.max(-15, 3 * (strengths[piece] - strengths[target])))
      expect(getCaptureOdds(game, legalMove(game, from, to))).toEqual({
        chance: 70 + strengthBonus, strengthBonus, supportBonus: 0, attackers: 0, defenders: 0,
      })
    })
  })

  describe.each(colors)('geometric support for %s', (color) => {
    it.each(supportCases)('$name', ({ fen, from, to, chance, strengthBonus, supportBonus, attackers, defenders }) => {
      const expected = { chance, strengthBonus, supportBonus, attackers, defenders }
      const random = randomRoll()
      const game = positionForColor(fen, color)
      const input = squaresForColor(from as Square, to as Square, color)
      const before = snapshot(game)
      const odds = getCaptureOdds(game, legalMove(game, input.from, input.to))
      expect(odds).toEqual(expected)
      for (const value of Object.values(odds ?? {})) expect(Number.isInteger(value)).toBe(true)
      expect(snapshot(game)).toEqual(before)
      expect(random).not.toHaveBeenCalled()
    })
  })

  it('does not replace the pawn strength with the promotion strength', () => {
    const game = new Chess(promotionFen)
    const odds = ['q', 'r', 'b', 'n'].map((promotion) => (
      getCaptureOdds(game, legalMove(game, 'a7', 'b8', promotion))
    ))
    expect(odds).toEqual(Array(4).fill({
      chance: 58, strengthBonus: -12, supportBonus: 0, attackers: 0, defenders: 0,
    }))
  })
})

describe('isCaptureRepetition', () => {
  it('does not count a position without history as repeated', () => {
    const game = new Chess()
    expect(isCaptureRepetition(game)).toBe(false)
    expect(isCaptureRepetition(new Chess(captureFen))).toBe(false)
  })

  describe.each(colors)('null turns from %s', (color) => {
    it.each([0, 1, 2, 3, 4, 5, 6])('counts only the current turn after %i passes', (passes) => {
      const game = new Chess(`7k/8/8/3p4/4P3/8/8/7K ${color} - - 0 1`)
      for (let index = 0; index < passes; index += 1) game.move(null)
      const before = snapshot(game)
      const expected = passes >= 4
      expect(game.turn()).toBe(passes % 2 === 0 ? color : color === 'w' ? 'b' : 'w')
      expect(isCaptureRepetition(game)).toBe(expected)
      expect(isCaptureGameOver(game)).toBe(expected)
      for (let index = 0; index < 10; index += 1) {
        game.history()
        game.history({ verbose: true })
        game.pgn()
        expect(isCaptureRepetition(game)).toBe(expected)
        expect(isCaptureGameOver(game)).toBe(expected)
        expect(game.fen()).toBe(before.fen)
      }
      expect(snapshot(game)).toEqual(before)
      expect(isCaptureRepetition(replayHistory(game))).toBe(expected)
    })
  })

  it.each(colors)('detects normal threefold repetition for %s and after PGN reload', (color) => {
    const game = new Chess()
    if (color === 'b') game.move('e4')
    const cycle = color === 'w'
      ? ['Nf3', 'Nf6', 'Ng1', 'Ng8']
      : ['Nf6', 'Nf3', 'Ng8', 'Ng1']
    for (const san of cycle) game.move(san)
    expect(isCaptureRepetition(game)).toBe(false)
    expect(isCaptureGameOver(game)).toBe(false)
    for (const san of cycle) game.move(san)
    expect(isCaptureRepetition(game)).toBe(true)
    expect(isCaptureGameOver(game)).toBe(true)
    const reloaded = new Chess()
    reloaded.loadPgn(game.pgn())
    for (let index = 0; index < 5; index += 1) {
      reloaded.history()
      reloaded.history({ verbose: true })
      reloaded.pgn()
      expect(isCaptureRepetition(reloaded)).toBe(true)
      expect(isCaptureGameOver(reloaded)).toBe(true)
    }
    expect(snapshot(reloaded)).toEqual(snapshot(game))
  })

  it('does not draw when an earlier position repeats but the current position does not', () => {
    const game = new Chess()
    for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(san)
    expect(isCaptureRepetition(game)).toBe(true)
    game.move('e4')
    expect(isCaptureRepetition(game)).toBe(false)
    expect(isCaptureGameOver(game)).toBe(false)
  })

  it('distinguishes castling rights on otherwise equal boards and turns', () => {
    const game = new Chess('4k3/8/8/8/8/8/8/4K2R w K - 0 1')
    const board = game.board()
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      for (const san of ['Rh2', 'Kf8', 'Rh1', 'Ke8']) game.move(san)
      expect(game.board()).toEqual(board)
      expect(game.turn()).toBe('w')
      expect(game.getCastlingRights('w').k).toBe(false)
      expect(isCaptureRepetition(game)).toBe(cycle === 3)
      expect(isCaptureGameOver(game)).toBe(cycle === 3)
    }
  })

  it('distinguishes a legal en passant target until it expires', () => {
    const game = new Chess('7k/8/8/3pP3/8/8/8/7K w - d6 0 1')
    expect(game.fen().split(' ')[3]).toBe('d6')
    for (let passes = 1; passes <= 6; passes += 1) {
      game.move(null)
      expect(game.fen().split(' ')[3]).toBe('-')
      expect(isCaptureRepetition(game)).toBe(passes >= 5)
      expect(isCaptureGameOver(game)).toBe(passes >= 5)
    }
  })

  it.each([
    '7k/8/8/3p4/8/8/8/7K w - d6 0 1',
    'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  ])('uses the normalized FEN for an illegal en passant target: %s', (fen) => {
    const game = new Chess(fen)
    expect(game.fen().split(' ')[3]).toBe('-')
    for (let passes = 1; passes <= 4; passes += 1) {
      game.move(null)
      expect(isCaptureRepetition(game)).toBe(passes === 4)
    }
  })

  it('updates the draw decision after undo and a new null turn', () => {
    const game = new Chess('7k/8/8/3p4/4P3/8/8/7K w - - 0 1')
    for (let index = 0; index < 4; index += 1) game.move(null)
    expect(isCaptureRepetition(game)).toBe(true)
    game.undo()
    expect(isCaptureRepetition(game)).toBe(false)
    expect(isCaptureGameOver(game)).toBe(false)
    game.undo()
    expect(isCaptureRepetition(game)).toBe(false)
    game.move(null)
    expect(isCaptureRepetition(game)).toBe(false)
    game.move(null)
    expect(isCaptureRepetition(game)).toBe(true)
    expect(isCaptureGameOver(game)).toBe(true)
  })
})

describe('isCaptureGameOver', () => {
  it.each([
    { name: 'checkmate', fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', expected: true },
    { name: 'stalemate', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', expected: true },
    { name: 'insufficient material', fen: '7k/8/6K1/8/8/8/8/8 w - - 0 1', expected: true },
    { name: 'fifty moves', fen: '7k/8/6K1/8/8/8/8/R7 w - - 100 80', expected: true },
    { name: 'ordinary check', fen: '7k/8/8/8/8/8/4r3/4K3 w - - 0 1', expected: false },
    { name: 'an active game', fen: captureFen, expected: false },
  ])('handles $name without hash-based draw methods', ({ fen, expected }) => {
    const game = new Chess(fen)
    const before = snapshot(game)
    const random = randomRoll()
    vi.spyOn(game, 'isGameOver').mockImplementation(() => { throw new Error('Unexpected native game over check') })
    vi.spyOn(game, 'isDraw').mockImplementation(() => { throw new Error('Unexpected native draw check') })
    vi.spyOn(game, 'isThreefoldRepetition').mockImplementation(() => { throw new Error('Unexpected native repetition check') })
    expect(isCaptureGameOver(game)).toBe(expected)
    expect(snapshot(game)).toEqual(before)
    expect(random).not.toHaveBeenCalled()
  })
})

describe('resolveMove', () => {
  it.each(colors)('allows four failed pawn captures before a repetition draw from %s', (color) => {
    const random = randomRoll()
    const game = new Chess(`7k/8/8/3p4/4P3/8/8/7K ${color} - - 0 1`)
    const board = game.board()
    vi.spyOn(game, 'isGameOver').mockImplementation(() => { throw new Error('Unexpected native game over check') })
    vi.spyOn(game, 'isDraw').mockImplementation(() => { throw new Error('Unexpected native draw check') })
    vi.spyOn(game, 'isThreefoldRepetition').mockReturnValue(true)
    for (let ply = 1; ply <= 4; ply += 1) {
      expect(game.isCheck()).toBe(false)
      expect(isCaptureGameOver(game)).toBe(false)
      const input = game.turn() === 'w' ? { from: 'e4', to: 'd5' } : { from: 'd5', to: 'e4' }
      const result = resolveMove(game, input, 0.99)
      expect(result).toMatchObject({
        move: { san: '--' },
        capture: { ply, ...input, piece: 'p', target: 'p', chance: 70, success: false },
        defeated: null,
      })
      expect(game.board()).toEqual(board)
      expect(game.turn()).toBe(ply % 2 === 0 ? color : color === 'w' ? 'b' : 'w')
      for (let index = 0; index < 3; index += 1) {
        game.history()
        game.history({ verbose: true })
        game.pgn()
        expect(isCaptureRepetition(game)).toBe(ply === 4)
        expect(isCaptureGameOver(game)).toBe(ply === 4)
      }
    }
    const before = snapshot(game)
    const move = vi.spyOn(game, 'move')
    const input = game.turn() === 'w' ? { from: 'e4', to: 'd5' } : { from: 'd5', to: 'e4' }
    expect(() => resolveMove(game, input)).toThrow('Game is over')
    expect(snapshot(game)).toEqual(before)
    expect(move).not.toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
  })

  it('makes an ordinary quiet move without RNG', () => {
    const random = randomRoll()
    const game = new Chess()
    const reference = new Chess()
    const expected = reference.move({ from: 'e2', to: 'e4' })
    const result = resolveMove(game, { from: 'e2', to: 'e4' })
    expect(result).toEqual({ move: expected, capture: null, defeated: null })
    expect(snapshot(game)).toEqual(snapshot(reference))
    expect(random).not.toHaveBeenCalled()
  })

  it('does not make a quiet move probabilistic when a roll is supplied', () => {
    const random = randomRoll()
    const game = new Chess()
    expect(resolveMove(game, { from: 'e2', to: 'e4' }, 0.999999).capture).toBeNull()
    expect(game.get('e4')).toEqual({ type: 'p', color: 'w' })
    expect(random).not.toHaveBeenCalled()
  })

  it.each([
    { fen: '7k/p7/8/8/8/8/8/7K w - - 0 1', from: 'h1', to: 'g1' },
    { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', from: 'e1', to: 'g1' },
    { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', from: 'e1', to: 'c1' },
    { fen: '7k/P7/8/8/8/8/8/7K w - - 0 1', from: 'a7', to: 'a8', promotion: 'n' },
    { fen: '7k/8/8/8/8/8/4r3/4K3 w - - 0 1', from: 'e1', to: 'd1' },
  ])('uses native chess.js for a quiet move from $from to $to', ({ fen, ...input }) => {
    const random = randomRoll()
    const game = new Chess(fen)
    const reference = new Chess(fen)
    expect(resolveMove(game, input)).toEqual({ move: reference.move(input), capture: null, defeated: null })
    expect(snapshot(game)).toEqual(snapshot(reference))
    expect(random).not.toHaveBeenCalled()
  })

  describe.each(colors)('capture thresholds for %s', (color) => {
    it.each([
      { roll: 0, success: true },
      { roll: 0.8199999999999998, success: true },
      { roll: 0.82, success: false },
      { roll: 0.8200000000000001, success: false },
      { roll: 0.9999999999999999, success: false },
    ])('resolves roll $roll with success $success', ({ roll, success }) => {
      const random = randomRoll()
      const game = positionForColor(captureFen, color)
      const reference = new Chess(game.fen())
      const input = squaresForColor('a1', 'a4', color)
      const result = resolveMove(game, input, roll)
      expect(result.capture).toEqual({
        chance: 82, strengthBonus: 12, supportBonus: 0, attackers: 0, defenders: 0,
        ply: 1, ...input, piece: 'r', target: 'p', color, roll, success,
      })
      expect(result.move).toEqual(reference.move(success ? input : null))
      expect(result.defeated).toBeNull()
      expect(snapshot(game)).toEqual(snapshot(reference))
      expect(game.turn()).toBe(color === 'w' ? 'b' : 'w')
      expect(random).not.toHaveBeenCalled()
    })
  })

  it.each([supportCases[6], supportCases[7]])('uses the exact bounded threshold: $chance', ({ fen, from, to, chance }) => {
    const input = { from, to }
    expect(resolveMove(new Chess(fen), input, chance / 100 - Number.EPSILON).capture?.success).toBe(true)
    expect(resolveMove(new Chess(fen), input, chance / 100).capture?.success).toBe(false)
  })

  it.each([0, 2 ** 31, 2 ** 32 - 1])('uses one cryptographic uint32 for a capture: %i', (value) => {
    const random = randomRoll(value)
    const game = new Chess(captureFen)
    const result = resolveMove(game, { from: 'a1', to: 'a4' })
    expect(random).toHaveBeenCalledTimes(1)
    const array = random.mock.calls[0][0]
    expect(array).toBeInstanceOf(Uint32Array)
    expect(array.length).toBe(1)
    expect(result.capture?.roll).toBe(value / 2 ** 32)
    expect(result.capture?.success).toBe(value / 2 ** 32 < 0.82)
  })

  it('does not fall back to noncryptographic RNG', () => {
    const random = randomRoll()
    random.mockImplementation(() => { throw new Error('RNG unavailable') })
    const game = new Chess(captureFen)
    const before = snapshot(game)
    expect(() => resolveMove(game, { from: 'a1', to: 'a4' })).toThrow('RNG unavailable')
    expect(snapshot(game)).toEqual(before)
  })

  it.each([NaN, Infinity, -Infinity, -0.01, 1, 1.01])('rejects an invalid capture roll without mutation or RNG: %s', (roll) => {
    const random = randomRoll()
    const game = new Chess(captureFen)
    const before = snapshot(game)
    const move = vi.spyOn(game, 'move')
    expect(() => resolveMove(game, { from: 'a1', to: 'a4' }, roll)).toThrow(RangeError)
    expect(snapshot(game)).toEqual(before)
    expect(move).not.toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
  })

  it('validates a supplied roll for a quiet move without RNG', () => {
    const random = randomRoll()
    const game = new Chess()
    const before = snapshot(game)
    expect(() => resolveMove(game, { from: 'e2', to: 'e4' }, NaN)).toThrow(RangeError)
    expect(snapshot(game)).toEqual(before)
    expect(random).not.toHaveBeenCalled()
  })

  it.each([
    { from: 'e2', to: 'e5' },
    { from: 'e7', to: 'e5' },
    { from: 'e3', to: 'e4' },
    { from: 'z2', to: 'e4' },
    { from: 'e2', to: 'e9' },
    { from: 'e2', to: 'e4', promotion: 'q' },
    { from: 'e1', to: 'e1' },
    { from: 'e1', to: 'g1' },
  ])('rejects an illegal input before mutation or RNG: %j', (input) => {
    const random = randomRoll()
    const game = new Chess()
    const before = snapshot(game)
    const move = vi.spyOn(game, 'move')
    expect(() => resolveMove(game, input)).toThrow('Illegal move')
    expect(() => resolveMove(game, input, NaN)).toThrow('Illegal move')
    expect(snapshot(game)).toEqual(before)
    expect(move).not.toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
  })

  it.each([
    { fen: '4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1', from: 'e2', to: 'c3' },
    { fen: '7k/8/8/3pP3/8/8/8/4K3 w - - 0 1', from: 'e5', to: 'd6' },
    { fen: promotionFen, from: 'a7', to: 'b8' },
    { fen: promotionFen, from: 'a7', to: 'b8', promotion: 'k' },
    { fen: '7k/8/8/8/8/8/4r3/4K3 w - - 0 1', from: 'e1', to: 'd2' },
  ])('rejects an illegal special move from $from to $to', ({ fen, ...input }) => {
    const random = randomRoll()
    const game = new Chess(fen)
    const before = snapshot(game)
    expect(() => resolveMove(game, input)).toThrow('Illegal move')
    expect(snapshot(game)).toEqual(before)
    expect(random).not.toHaveBeenCalled()
  })

  it.each([
    '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    '7k/8/6K1/8/8/8/8/8 w - - 0 1',
    '7k/8/6K1/8/8/8/8/R7 w - - 100 80',
  ])('refuses a finished game without mutation or RNG: %s', (fen) => {
    const random = randomRoll()
    const game = new Chess(fen)
    const before = snapshot(game)
    expect(game.isGameOver()).toBe(true)
    expect(() => resolveMove(game, { from: 'a1', to: 'a2' })).toThrow('Game is over')
    expect(snapshot(game)).toEqual(before)
    expect(random).not.toHaveBeenCalled()
  })

  it('refuses a game after threefold repetition', () => {
    const random = randomRoll()
    const game = new Chess()
    for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(san)
    const before = snapshot(game)
    expect(game.isThreefoldRepetition()).toBe(true)
    expect(() => resolveMove(game, { from: 'e2', to: 'e4' })).toThrow('Game is over')
    expect(snapshot(game)).toEqual(before)
    expect(random).not.toHaveBeenCalled()
  })

  describe.each(colors)('failed captures for %s', (color) => {
    it('consumes a native null turn and preserves pieces and castling rights', () => {
      const game = new Chess(color === 'w'
        ? 'r3k2r/8/8/8/8/8/p7/R3K2R w KQkq - 7 12'
        : 'r3k2r/P7/8/8/8/8/8/R3K2R b KQkq - 7 12')
      const before = snapshot(game)
      const reference = new Chess(game.fen())
      const input = squaresForColor('a1', 'a2', color)
      const result = resolveMove(game, input, 0.99)
      expect(result.move).toEqual(reference.move(null))
      expect(result.move?.san).toBe('--')
      expect(result.defeated).toBeNull()
      expect(game.board()).toEqual(before.board)
      expect(game.getCastlingRights('w')).toEqual(before.castling.w)
      expect(game.getCastlingRights('b')).toEqual(before.castling.b)
      expect(game.history()).toEqual(['--'])
      expect(game.fen().split(' ').slice(4)).toEqual(['8', color === 'w' ? '12' : '13'])
      expect(snapshot(game)).toEqual(snapshot(reference))
    })

    it.each([
      { fen: '7k/8/8/8/8/8/r3K3/R7 w - - 0 1', from: 'a1', to: 'a2' },
      { fen: '7k/8/8/8/8/8/4r3/4K3 w - - 0 1', from: 'e1', to: 'e2' },
    ])('loses without mutation when already in check: $from to $to', ({ fen, from, to }) => {
      const random = randomRoll()
      const game = positionForColor(fen, color)
      const before = snapshot(game)
      const input = squaresForColor(from as Square, to as Square, color)
      const move = vi.spyOn(game, 'move')
      expect(game.isCheck()).toBe(true)
      const result = resolveMove(game, input, 0.99)
      expect(result).toMatchObject({ move: null, defeated: color, capture: { ...input, color, success: false, ply: 1 } })
      expect(snapshot(game)).toEqual(before)
      expect(move).not.toHaveBeenCalled()
      expect(random).not.toHaveBeenCalled()
    })

    it('uses one cryptographic roll for a failed capture in check without mutation', () => {
      const random = randomRoll(2 ** 32 - 1)
      const game = positionForColor('7k/8/8/8/8/8/4r3/4K3 w - - 0 1', color)
      const before = snapshot(game)
      const result = resolveMove(game, squaresForColor('e1', 'e2', color))
      expect(result).toMatchObject({ move: null, defeated: color, capture: { success: false } })
      expect(snapshot(game)).toEqual(before)
      expect(random).toHaveBeenCalledTimes(1)
    })

    it('allows a successful nonking capture to escape check', () => {
      const game = positionForColor('7k/8/8/8/8/8/r3K3/R7 w - - 0 1', color)
      const input = squaresForColor('a1', 'a2', color)
      expect(game.isCheck()).toBe(true)
      expect(resolveMove(game, input, 0)).toMatchObject({ defeated: null, capture: { success: true } })
      expect(game.get(input.from)).toBeUndefined()
      expect(game.get(input.to)).toEqual({ type: 'r', color })
      expect(game.history()).toEqual([color === 'w' ? 'Rxa2' : 'Rxa7'])
    })

    it('does not use hypothetical check after a successful capture to decide defeat', () => {
      const fen = '8/8/8/8/3p3k/8/8/3R3K w - - 0 1'
      const game = positionForColor(fen, color)
      const input = squaresForColor('d1', 'd4', color)
      const hypothetical = new Chess(game.fen())
      hypothetical.move(input)
      expect(hypothetical.isCheck()).toBe(true)
      expect(game.isCheck()).toBe(false)
      const result = resolveMove(game, input, 0.99)
      expect(result.capture?.success).toBe(false)
      expect(result.move?.san).toBe('--')
      expect(result.defeated).toBeNull()
    })
  })

  describe.each(colors)('special captures for %s', (color) => {
    it.each([0, 0.99])('resolves a king capture with roll %s', (roll) => {
      const { game, from, to } = strengthPosition('k', 'n', color)
      game.put({ type: 'p', color }, color === 'w' ? 'g2' : 'g7')
      const reference = new Chess(game.fen())
      const result = resolveMove(game, { from, to }, roll)
      expect(result.capture).toMatchObject({ piece: 'k', target: 'n', strengthBonus: 3, chance: 73, success: roll === 0 })
      expect(result.defeated).toBeNull()
      expect(result.move).toEqual(reference.move(roll === 0 ? { from, to } : null))
      expect(snapshot(game)).toEqual(snapshot(reference))
    })

    it('allows a successful king capture to escape check', () => {
      const game = positionForColor('7k/8/8/8/8/8/4r3/4K3 w - - 0 1', color)
      const input = squaresForColor('e1', 'e2', color)
      expect(game.isCheck()).toBe(true)
      const result = resolveMove(game, input, 0)
      expect(result.capture).toMatchObject({ piece: 'k', target: 'r', strengthBonus: -3, success: true })
      expect(result.defeated).toBeNull()
      expect(game.get(input.to)).toEqual({ type: 'k', color })
      expect(game.isCheck()).toBe(false)
    })

    describe.each([
      { name: 'en passant', fen: '7k/8/8/3pP3/4K3/8/8/8 w - d6 0 1', from: 'e5', to: 'd6' },
      { name: 'promotion', fen: '1r5k/P7/8/8/8/8/8/1K6 w - - 0 1', from: 'a7', to: 'b8', promotion: 'q' },
    ])('$name while in check', ({ fen, from, to, promotion }) => {
      it.each([0, 0.99])('resolves roll %s from the position before the attempt', (roll) => {
        const game = positionForColor(fen, color)
        const before = snapshot(game)
        const reference = new Chess(game.fen())
        const input = { ...squaresForColor(from as Square, to as Square, color), promotion }
        expect(game.isCheck()).toBe(true)
        const result = resolveMove(game, input, roll)
        expect(result.capture?.success).toBe(roll === 0)
        if (roll === 0) {
          expect(result.move).toEqual(reference.move(input))
          expect(result.defeated).toBeNull()
          expect(snapshot(game)).toEqual(snapshot(reference))
        } else {
          expect(result.move).toBeNull()
          expect(result.defeated).toBe(color)
          expect(snapshot(game)).toEqual(before)
        }
      })
    })

    it.each([0, 0.99])('resolves en passant with roll %s', (roll) => {
      const game = positionForColor(enPassantFen, color)
      const reference = new Chess(game.fen())
      const before = snapshot(game)
      const input = squaresForColor('e5', 'd6', color)
      const victim = color === 'w' ? 'd5' : 'd4'
      const result = resolveMove(game, input, roll)
      expect(result.capture).toMatchObject({ target: 'p', attackers: 1, defenders: 3, chance: 54, success: roll === 0 })
      expect(result.move).toEqual(reference.move(roll === 0 ? input : null))
      expect(result.defeated).toBeNull()
      expect(game.fen().split(' ')[3]).toBe('-')
      if (roll === 0) {
        expect(result.move?.isEnPassant()).toBe(true)
        expect(game.get(victim)).toBeUndefined()
        expect(game.get(input.from)).toBeUndefined()
        expect(game.get(input.to)).toEqual({ type: 'p', color })
      } else {
        expect(game.board()).toEqual(before.board)
        expect(game.get(victim)).toEqual({ type: 'p', color: color === 'w' ? 'b' : 'w' })
      }
      expect(snapshot(game)).toEqual(snapshot(reference))
      const reloaded = replayHistory(game)
      expect(snapshot(reloaded)).toEqual(snapshot(game))
      if (roll === 0) {
        const fromPgn = new Chess()
        fromPgn.loadPgn(game.pgn())
        expect(snapshot(fromPgn)).toEqual(snapshot(game))
      } else {
        expect(game.pgn()).toContain('--')
      }
      expect(game.undo()?.san).toBe(result.move?.san)
      expect(snapshot(game)).toEqual(before)
    })

    describe.each(['q', 'r', 'b', 'n'])('promotion to %s', (promotion) => {
      it.each([0, 0.99])('resolves the capture with roll %s', (roll) => {
        const game = positionForColor(promotionFen, color)
        const reference = new Chess(game.fen())
        const before = snapshot(game)
        const input = { ...squaresForColor('a7', 'b8', color), promotion }
        const result = resolveMove(game, input, roll)
        expect(result.capture).toMatchObject({ piece: 'p', target: 'r', strengthBonus: -12, chance: 58, success: roll === 0 })
        expect(result.move).toEqual(reference.move(roll === 0 ? input : null))
        expect(result.defeated).toBeNull()
        if (roll === 0) {
          expect(game.get(input.to)).toEqual({ type: promotion, color })
          expect(game.get(input.from)).toBeUndefined()
          expect(result.move?.isPromotion()).toBe(true)
        } else {
          expect(game.board()).toEqual(before.board)
          expect(game.get(input.from)).toEqual({ type: 'p', color })
        }
        expect(snapshot(game)).toEqual(snapshot(reference))
        const reloaded = replayHistory(game)
        expect(snapshot(reloaded)).toEqual(snapshot(game))
        if (roll === 0) {
          const fromPgn = new Chess()
          fromPgn.loadPgn(game.pgn())
          expect(snapshot(fromPgn)).toEqual(snapshot(game))
        } else {
          expect(game.pgn()).toContain('--')
        }
        game.undo()
        expect(snapshot(game)).toEqual(before)
      })
    })
  })

  it('records ply from history rather than the FEN full move number', () => {
    const game = new Chess('7k/8/8/8/p7/8/8/R3K3 w - - 0 80')
    expect(resolveMove(game, { from: 'a1', to: 'a4' }, 0).capture?.ply).toBe(1)
  })

  it('preserves successful captures through PGN reload and undo', () => {
    const game = new Chess()
    resolveMove(game, { from: 'e2', to: 'e4' })
    resolveMove(game, { from: 'd7', to: 'd5' })
    const before = snapshot(game)
    expect(resolveMove(game, { from: 'e4', to: 'd5' }, 0).capture?.ply).toBe(3)
    const reloaded = new Chess()
    reloaded.loadPgn(game.pgn())
    expect(snapshot(reloaded)).toEqual(snapshot(game))
    game.undo()
    reloaded.undo()
    expect(snapshot(game)).toEqual(before)
    expect(snapshot(reloaded)).toEqual(before)
  })

  it('exposes the native chess.js limitation for null turns in PGN reload', () => {
    const game = new Chess()
    resolveMove(game, { from: 'e2', to: 'e4' })
    resolveMove(game, { from: 'd7', to: 'd5' })
    resolveMove(game, { from: 'e4', to: 'd5' }, 0.99)
    const pgn = game.pgn()
    expect(pgn).toContain('2. --')
    expect(() => new Chess().loadPgn(pgn)).toThrow('Expected standard algebraic notation or whitespace but "-" found.')
    expect(snapshot(replayHistory(game))).toEqual(snapshot(game))
  })

  it('preserves captures and native null turns through history replay and undo', () => {
    const game = new Chess()
    const reference = new Chess()
    const initial = snapshot(game)
    const inputs = [
      { from: 'e2', to: 'e4', roll: 0, capture: false },
      { from: 'd7', to: 'd5', roll: 0, capture: false },
      { from: 'e4', to: 'd5', roll: 0.99, capture: true },
      { from: 'd5', to: 'e4', roll: 0, capture: true },
      { from: 'd2', to: 'd3', roll: 0, capture: false },
      { from: 'e4', to: 'd3', roll: 0.99, capture: true },
    ]
    const states = [initial]
    for (const [index, { from, to, roll, capture }] of inputs.entries()) {
      const result = resolveMove(game, { from, to }, roll)
      const expected = reference.move(capture && roll === 0.99 ? null : { from, to })
      expect(result.move).toEqual(expected)
      expect(result.defeated).toBeNull()
      if (capture) expect(result.capture?.ply).toBe(index + 1)
      else expect(result.capture).toBeNull()
      expect(snapshot(game)).toEqual(snapshot(reference))
      const reloaded = replayHistory(game)
      expect(snapshot(reloaded)).toEqual(snapshot(game))
      states.push(snapshot(game))
    }
    expect(game.history()).toEqual(['e4', 'd5', '--', 'dxe4', 'd3', '--'])
    expect(game.pgn()).toContain('1. e4 d5 2. -- dxe4 3. d3 --')
    const reloaded = replayHistory(game)
    for (let index = inputs.length - 1; index >= 0; index -= 1) {
      expect(game.undo()).not.toBeNull()
      expect(reloaded.undo()).not.toBeNull()
      expect(snapshot(game)).toEqual(states[index])
      expect(snapshot(reloaded)).toEqual(states[index])
    }
    expect(snapshot(game)).toEqual(initial)
    expect(game.undo()).toBeNull()
  })
})
