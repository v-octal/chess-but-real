import { Chess } from 'chess.js'
import type { Move } from 'chess.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getComputerMove } from './engine'
import type { ComputerMove } from './engine'
import type { EngineRequest, EngineResponse } from './engine.worker'

const { getCaptureOdds } = vi.hoisted(() => ({
  getCaptureOdds: vi.fn<(game: Chess, move: Move) => {
    chance: number
    strengthBonus: number
    supportBonus: number
    attackers: number
    defenders: number
  } | null>(),
}))

vi.mock('./capture', () => ({ getCaptureOdds }))

const levels = [1, 2, 3, 4]

function captureOdds(chance: number) {
  return { chance, strengthBonus: 0, supportBonus: 0, attackers: 0, defenders: 0 }
}

function observeSearchPositions() {
  const positions = new Map<Chess, { fen: string; hash: string }>()
  const load = Chess.prototype.load
  vi.spyOn(Chess.prototype, 'load').mockImplementation(function (this: Chess, ...args: Parameters<Chess['load']>) {
    load.apply(this, args)
    if (!positions.has(this)) positions.set(this, { fen: this.fen(), hash: this.hash() })
  })
  return positions
}

function expectPositionsRestored(positions: Map<Chess, { fen: string; hash: string }>) {
  expect(positions.size).toBeGreaterThan(0)
  for (const [game, initial] of positions) {
    expect(game.fen()).toBe(initial.fen)
    expect(game.hash()).toBe(initial.hash)
    expect(game.history()).toEqual([])
  }
}

beforeEach(() => {
  getCaptureOdds.mockReset()
  getCaptureOdds.mockImplementation((_, move) => move.captured ? captureOdds(95) : null)
})

function legalMove(fen: string, level: number): ComputerMove {
  const game = new Chess(fen)
  const move = getComputerMove(fen, level)
  expect(move).not.toBeNull()
  if (!move) throw new Error('Expected a legal move')

  const legalMoves = game.moves({ verbose: true }).map((candidate) => (
    candidate.promotion
      ? { from: candidate.from, to: candidate.to, promotion: candidate.promotion }
      : { from: candidate.from, to: candidate.to }
  ))
  expect(legalMoves).toContainEqual(move)
  expect(() => game.move(move)).not.toThrow()
  return move
}

async function createWorker() {
  vi.resetModules()
  const worker = {
    onmessage: null as ((event: MessageEvent<EngineRequest>) => void) | null,
    postMessage: vi.fn<(response: EngineResponse) => void>(),
  }
  vi.stubGlobal('self', worker)
  await import('./engine.worker')
  return worker
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('getComputerMove', () => {
  it.each(levels)('returns a legal initial move at level %i', (level) => {
    const game = new Chess()
    const move = legalMove(game.fen(), level)
    expect(game.move(move).color).toBe('w')
    expect(move).not.toHaveProperty('promotion')
  })

  it.each(levels)('returns a legal black reply after e4 at level %i', (level) => {
    const game = new Chess()
    game.move('e4')
    const move = legalMove(game.fen(), level)
    expect(game.move(move).color).toBe('b')
    expect(game.turn()).toBe('w')
  })

  it.each(levels)('returns null for checkmate at level %i', (level) => {
    const game = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')
    expect(game.isCheckmate()).toBe(true)
    expect(getComputerMove(game.fen(), level)).toBeNull()
  })

  it.each([
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    '7k/8/6K1/8/8/8/8/8 w - - 0 1',
    '7k/8/6K1/8/8/8/8/R7 w - - 100 80',
  ])('returns null for a drawn position: %s', (fen) => {
    expect(new Chess(fen).isDraw()).toBe(true)
    expect(getComputerMove(fen, 4)).toBeNull()
  })

  describe.each([3, 4])('mate preference at level %i', (level) => {
    it.each([
      '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
      '8/8/8/8/8/6k1/5q2/7K b - - 0 1',
    ])('selects mate in one: %s', (fen) => {
      const game = new Chess(fen)
      const move = legalMove(fen, level)
      game.move(move)
      expect(game.isCheckmate()).toBe(true)
    })
  })

  describe.each(levels)('promotions at level %i', (level) => {
    it.each([
      { fen: '7k/P7/8/8/8/8/8/4K3 w - - 0 1', from: 'a7', to: 'a8' },
      { fen: '4k3/8/8/8/8/8/p7/7K b - - 0 1', from: 'a2', to: 'a1' },
    ])('includes a legal promotion from $from', ({ fen, from, to }) => {
      expect(legalMove(fen, level)).toEqual({ from, to, promotion: 'q' })
    })
  })

  it('uses an underpromotion instead of immediate stalemate', () => {
    const fen = '8/k1P5/2K5/8/8/8/8/8 w - - 0 1'
    const queenPromotion = new Chess(fen)
    queenPromotion.move({ from: 'c7', to: 'c8', promotion: 'q' })
    expect(queenPromotion.isStalemate()).toBe(true)
    expect(legalMove(fen, 1)).toEqual({ from: 'c7', to: 'c8', promotion: 'r' })
  })

  it('returns the only legal move while in check', () => {
    const fen = '7k/6Q1/8/5K2/8/8/8/8 b - - 0 1'
    const game = new Chess(fen)
    expect(game.isCheck()).toBe(true)
    expect(game.moves()).toHaveLength(1)
    expect(legalMove(fen, 4)).toEqual({ from: 'h8', to: 'g7' })
  })

  it.each([
    ['e4', 'a6', 'e5', 'd5'],
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'],
  ])('preserves the supplied position after %j', (...moves) => {
    const game = new Chess()
    for (const move of moves) game.move(move)
    const fen = game.fen()
    const hash = game.hash()
    const history = game.history()
    const board = game.board()
    const rights = game.getCastlingRights(game.turn())
    const choices = game.moves()

    const result = legalMove(fen, 3)

    expect(game.fen()).toBe(fen)
    expect(game.hash()).toBe(hash)
    expect(game.history()).toEqual(history)
    expect(game.board()).toEqual(board)
    expect(game.getCastlingRights(game.turn())).toEqual(rights)
    expect(game.moves()).toEqual(choices)
    expect(() => game.move(result)).not.toThrow()
  })

  it('uses the supplied en passant target', () => {
    const fen = '7k/8/8/3pP3/8/8/8/4K3 w - d6 0 1'
    const move = legalMove(fen, 1)
    expect(move).toEqual({ from: 'e5', to: 'd6' })
    const game = new Chess(fen)
    expect(game.move(move).isEnPassant()).toBe(true)
    expect(game.get('d5')).toBeUndefined()
  })

  it.each([
    { fen: '7k/3q4/8/8/3R2r1/8/8/K7 w - - 0 1', from: 'd4', reliable: 'g4', valuable: 'd7' },
    { fen: 'k7/8/8/3r2R1/8/8/3Q4/7K b - - 0 1', from: 'd5', reliable: 'g5', valuable: 'd2' },
  ])('weighs capture probability for $from', ({ fen, from, reliable, valuable }) => {
    getCaptureOdds.mockImplementation((_, move) => (
      move.captured ? captureOdds(move.captured === 'q' ? 40 : 95) : null
    ))
    expect(legalMove(fen, 1)).toEqual({ from, to: reliable })

    getCaptureOdds.mockImplementation((_, move) => (
      move.captured ? captureOdds(move.captured === 'q' ? 95 : 40) : null
    ))
    expect(legalMove(fen, 1)).toEqual({ from, to: valuable })
  })

  it('accounts for the opponent capture probability in its reply search', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const fen = '1q5r/8/4k3/8/8/8/8/1R2K2Q w - - 0 1'
    let opponentChance = 40
    getCaptureOdds.mockImplementation((_, move) => {
      if (!move.captured) return null
      return captureOdds(move.captured === 'q' ? (move.color === 'w' ? 60 : opponentChance) : 40)
    })

    expect(legalMove(fen, 2)).toEqual({ from: 'b1', to: 'b8' })
    opponentChance = 95
    expect(legalMove(fen, 2)).not.toEqual({ from: 'b1', to: 'b8' })
  })

  it('prefers a safe check escape over a capture with a high success probability', () => {
    const fen = 'k3r3/8/8/1B6/8/8/8/4K3 w - - 0 1'
    const game = new Chess(fen)
    expect(game.isCheck()).toBe(true)
    expect(game.moves({ verbose: true }).some((move) => move.san === 'Bxe8')).toBe(true)

    const result = game.move(legalMove(fen, 2))
    expect(result.captured).toBeUndefined()
    expect(game.isCheck()).toBe(false)
  })

  it('searches the failure branch of a capturing mate without random rolls or null moves', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const fen = '7k/6n1/5K2/8/8/8/8/6Q1 w - - 0 1'
    const hash = new Chess(fen).hash()
    const failureFen = '7k/6n1/5K2/8/8/8/8/6Q1 b - - 1 1'
    const positions = observeSearchPositions()
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('The search must not roll capture odds')
    })
    const moves = vi.spyOn(Chess.prototype, 'move')
    const result = getComputerMove(fen, 2)

    expect(result).toEqual({ from: 'g1', to: 'g7' })
    expect(moves).not.toHaveBeenCalledWith(null)
    expect(getCaptureOdds.mock.calls.some(([game]) => positions.get(game)?.fen === failureFen)).toBe(true)
    expect(positions.keys().next().value?.hash()).toBe(hash)
    expectPositionsRestored(positions)
    expect(random).not.toHaveBeenCalled()
  })

  it('prefers a quiet mate over a risky capturing mate', () => {
    const fen = '7k/5Q1p/5KB1/8/8/8/8/8 w - - 0 1'
    const game = new Chess(fen)
    expect(game.moves({ verbose: true }).some((move) => move.captured && move.san.endsWith('#'))).toBe(true)

    const result = game.move(legalMove(fen, 4))
    expect(result.captured).toBeUndefined()
    expect(game.isCheckmate()).toBe(true)
  })

  it('returns a legal capture promotion with its promotion piece', () => {
    const fen = '1r5k/P7/8/8/8/8/8/4K3 w - - 0 1'
    const move = legalMove(fen, 1)
    expect(move).toEqual({ from: 'a7', to: 'b8', promotion: 'q' })
    expect(new Chess(fen).move(move).isCapture()).toBe(true)
  })

  it.each([
    {
      fen: 'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 17 42',
      failureFen: 'r3k2r/8/8/3pP3/8/8/8/R3K2R b KQkq - 18 42',
    },
    {
      fen: 'r3k2r/8/8/8/3Pp3/8/8/R3K2R b KQkq d3 23 42',
      failureFen: 'r3k2r/8/8/8/3Pp3/8/8/R3K2R w KQkq - 24 43',
    },
  ])('searches a fresh failed-turn position with correct FEN fields: $fen', ({ fen, failureFen }) => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const source = new Chess(fen)
    const expectedFailureHash = new Chess(failureFen).hash()
    const positions = observeSearchPositions()
    const mutations = vi.spyOn(Chess.prototype, 'move')
    const failures = new Set<Chess>()
    getCaptureOdds.mockImplementation((game, move) => {
      if (game.fen() === failureFen) {
        failures.add(game)
        expect(game.hash()).toBe(expectedFailureHash)
      }
      return move.captured ? captureOdds(95) : null
    })

    const result = getComputerMove(fen, 2)

    expect(source.moves({ verbose: true }).some((move) => (
      move.from === result?.from && move.to === result?.to && move.promotion === result?.promotion
    ))).toBe(true)
    const root = positions.keys().next().value
    expect(root?.fen()).toBe(fen)
    expect(root?.hash()).toBe(source.hash())
    expect(failures.size).toBeGreaterThan(0)
    for (const game of failures) {
      expect(game).not.toBe(root)
      expect(positions.get(game)?.fen).toBe(failureFen)
      expect(game.board()).toEqual(source.board())
      expect(game.turn()).not.toBe(source.turn())
      expect(game.getCastlingRights('w')).toEqual(source.getCastlingRights('w'))
      expect(game.getCastlingRights('b')).toEqual(source.getCastlingRights('b'))
    }
    expectPositionsRestored(positions)
    expect(mutations).not.toHaveBeenCalledWith(null)
  })

  it.each([
    { branch: 'success', ply: 1 },
    { branch: 'failure', ply: 1 },
    { branch: 'success', ply: 2 },
    { branch: 'failure', ply: 2 },
  ])('restores every position after a timeout in the $branch branch at ply $ply', ({ branch, ply }) => {
    const fen = '3r3k/8/8/3pP3/8/8/8/4K3 w - d6 0 1'
    const source = new Chess(fen)
    const failureFen = ply === 1
      ? '3r3k/8/8/3pP3/8/8/8/4K3 b - - 1 1'
      : '3r3k/8/3P4/8/8/8/8/4K3 w - - 1 2'
    const positions = observeSearchPositions()
    let interruptedGame: Chess | undefined
    const mutations = vi.spyOn(Chess.prototype, 'move')
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const activeGame = mutations.mock.contexts.at(-1) as Chess | undefined
      const root = positions.keys().next().value
      const initial = activeGame && positions.get(activeGame)
      const targetBranch = branch === 'success'
        ? activeGame === root && (activeGame?.history().length ?? 0) >= ply
        : initial?.fen === failureFen && (activeGame?.history().length ?? 0) > 0
      if (targetBranch) interruptedGame = activeGame
      return interruptedGame ? 10_000 : 0
    })

    const result = getComputerMove(fen, 3)

    expect(source.moves({ verbose: true }).some((move) => (
      move.from === result?.from && move.to === result?.to
    ))).toBe(true)
    expect(interruptedGame).toBeDefined()
    const root = positions.keys().next().value
    expect(root?.fen()).toBe(fen)
    expect(root?.hash()).toBe(source.hash())
    expect(root?.get('d5')).toEqual({ type: 'p', color: 'b' })
    expectPositionsRestored(positions)
    expect(mutations).not.toHaveBeenCalledWith(null)
    if (branch === 'failure') {
      expect(interruptedGame).not.toBe(root)
      expect(interruptedGame && positions.get(interruptedGame)?.fen).toBe(failureFen)
      expect(getCaptureOdds.mock.calls.some(([game]) => game === interruptedGame)).toBe(true)
    } else {
      expect(interruptedGame).toBe(root)
    }
  })

  it('returns a legal fallback when the search reaches its time limit', () => {
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      elapsed += 1000
      return elapsed
    })
    legalMove(new Chess().fen(), 4)
  })

  it.each([0, 5, 2.5, NaN, Infinity])('handles an out-of-range level: %s', (level) => {
    legalMove('7k/6Q1/8/5K2/8/8/8/8 b - - 0 1', level)
  })

  it('rejects an invalid FEN', () => {
    expect(() => getComputerMove('invalid fen', 4)).toThrow()
  })
})

describe('engine worker', () => {
  it('returns a legal move with the original FEN and request ID', async () => {
    const worker = await createWorker()
    const game = new Chess()
    game.move('e4')
    const request: EngineRequest = { fen: game.fen(), level: 1, requestId: 'reply-1' }

    worker.onmessage?.(new MessageEvent('message', { data: request }))

    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    const response = worker.postMessage.mock.calls[0][0]
    expect(response).toEqual({ move: expect.any(Object), fen: request.fen, requestId: request.requestId })
    expect(response.move).not.toBeNull()
    expect(game.move(response.move).color).toBe('b')
  })

  it('returns null without an error for checkmate', async () => {
    const worker = await createWorker()
    const request: EngineRequest = {
      fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
      level: 4,
      requestId: 2,
    }

    worker.onmessage?.(new MessageEvent('message', { data: request }))

    expect(worker.postMessage).toHaveBeenCalledWith({ move: null, fen: request.fen, requestId: 2 })
  })

  it('returns an error for invalid FEN and accepts the next request', async () => {
    const worker = await createWorker()
    const request: EngineRequest = { fen: 'invalid fen', level: 4, requestId: 3 }

    worker.onmessage?.(new MessageEvent('message', { data: request }))

    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      move: null,
      fen: request.fen,
      requestId: 3,
      error: expect.any(String),
    })

    const nextRequest: EngineRequest = { fen: new Chess().fen(), level: 1, requestId: 4 }
    worker.onmessage?.(new MessageEvent('message', { data: nextRequest }))
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      move: expect.any(Object),
      fen: nextRequest.fen,
      requestId: 4,
    })
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
  })
})
