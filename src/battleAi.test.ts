import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Color, PieceSymbol, Square } from 'chess.js'
import { UNIT_STATS, applyBattleAction, battleActions, createBattle } from './battle'
import type { BattlePiece, BattleState } from './battle'
import { getBattleComputerMove, validateBattle } from './battleAi'
import type { BattleComputerMove } from './battleAi'

function piece(type: PieceSymbol, color: Color, id: string, hp = UNIT_STATS[type].health): BattlePiece {
  return { id, type, color, hp, moved: true }
}

function position(board: Partial<Record<Square, BattlePiece>>, turn: Color = 'w'): BattleState {
  return { board, turn, ply: turn === 'w' ? 0 : 1, winner: null, lastAction: null, enPassant: null, quietTurns: 0 }
}

function expectLegal(state: BattleState, move: BattleComputerMove | null): void {
  expect(move).not.toBeNull()
  expect(battleActions(state).some((action) => action.from === move!.from && action.to === move!.to
    && action.promotion === move!.promotion)).toBe(true)
  expect(applyBattleAction(state, {
    from: move!.from as Square,
    to: move!.to as Square,
    ...(move!.promotion ? { promotion: move!.promotion as PieceSymbol } : {}),
  })).not.toBeNull()
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('battle computer moves', () => {
  it.each([1, 2, 3, 4])('returns a legal opening action at level %i', (level) => {
    const state = createBattle()
    expectLegal(state, getBattleComputerMove(state, level))
  })

  it.each([1, 2, 3, 4])('takes a lethal king attack first at level %i', (level) => {
    const state = position({
      h1: piece('k', 'w', 'wk'),
      a4: piece('r', 'w', 'wr'),
      a5: piece('k', 'b', 'bk', 1),
      b4: piece('q', 'b', 'bq', 1),
    })
    const move = getBattleComputerMove(state, level)
    expect(move).toEqual({ from: 'a4', to: 'a5' })
    expectLegal(state, move)
  })

  it('takes a lethal king attack as black', () => {
    const state = position({
      h8: piece('k', 'b', 'bk'),
      a5: piece('r', 'b', 'br'),
      a4: piece('k', 'w', 'wk', 1),
    }, 'b')
    const move = getBattleComputerMove(state, 2)
    expect(move).toEqual({ from: 'a5', to: 'a4' })
    expectLegal(state, move)
  })

  it('promotes a pawn with a legal promotion choice', () => {
    const state = position({
      h1: piece('k', 'w', 'wk'),
      a7: piece('p', 'w', 'wp'),
      h8: piece('k', 'b', 'bk'),
    })
    const move = getBattleComputerMove(state, 2)
    expect(move).toEqual({ from: 'a7', to: 'a8', promotion: 'q' })
    expectLegal(state, move)
  })

  it('moves closer to distant targets when no attack exists', () => {
    const state = position({
      a1: piece('k', 'w', 'wk'),
      b1: piece('r', 'w', 'wr'),
      g7: piece('p', 'b', 'bp'),
      h8: piece('k', 'b', 'bk'),
    })
    expect(battleActions(state).some((action) => action.kind === 'attack')).toBe(false)
    const move = getBattleComputerMove(state, 1)
    expectLegal(state, move)
    expect(move!.from).toBe('b1')
    const nearest = Math.min(...['g7', 'h8'].map((target) => Math.max(
      Math.abs(move!.to.charCodeAt(0) - target.charCodeAt(0)),
      Math.abs(Number(move!.to[1]) - Number(target[1])),
    )))
    expect(nearest).toBeLessThan(6)
  })

  it('keeps a legal fallback when the time budget expires', () => {
    const state = createBattle()
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      elapsed += 20
      return elapsed
    })
    expectLegal(state, getBattleComputerMove(state, 1))
    expect(elapsed).toBeLessThanOrEqual(100)
  })

  it('finishes the lower-health victim instead of damaging an identical healthy unit', () => {
    const state = position({
      a1: piece('k', 'w', 'wk'),
      d4: piece('r', 'w', 'wr'),
      h8: piece('k', 'b', 'bk'),
      d5: piece('q', 'b', 'weak', 1),
      e4: piece('q', 'b', 'healthy'),
    })
    const move = getBattleComputerMove(state, 2)
    expect(move).toEqual({ from: 'd4', to: 'd5' })
    expectLegal(state, move)
  })

  it('protects an injured unit from an immediate lethal reply', () => {
    const state = position({
      a1: piece('k', 'w', 'wk'),
      d4: piece('q', 'w', 'injured', 1),
      h8: piece('k', 'b', 'bk'),
      d6: piece('r', 'b', 'br'),
    })
    expect(battleActions({ ...state, turn: 'b' }).some((action) => action.to === 'd4' && action.lethal)).toBe(true)
    const move = getBattleComputerMove(state, 2)
    expectLegal(state, move)
    const next = applyBattleAction(state, { from: move!.from as Square, to: move!.to as Square })!
    const survivor = Object.entries(next.board).find(([, unit]) => unit?.id === 'injured')
    expect(survivor).toBeDefined()
    expect(battleActions(next).some((action) => action.kind === 'attack' && action.lethal
      && (action.victimSquare ?? action.to) === survivor![0])).toBe(false)
  })

  it.each(Array.from({ length: 25 }, (_, index) => index))('protects the injured unit after a timeout at check %i', (checks) => {
    const state = position({
      a1: piece('k', 'w', 'wk'),
      d4: piece('q', 'w', 'injured', 1),
      h8: piece('k', 'b', 'bk'),
      d6: piece('r', 'b', 'br'),
    })
    let calls = 0
    vi.spyOn(performance, 'now').mockImplementation(() => calls++ <= checks ? 0 : 1000)
    const move = getBattleComputerMove(state, 2)
    expectLegal(state, move)
    const next = applyBattleAction(state, { from: move!.from as Square, to: move!.to as Square })!
    const survivor = Object.entries(next.board).find(([, unit]) => unit?.id === 'injured')
    expect(survivor).toBeDefined()
    expect(battleActions(next).some((action) => action.kind === 'attack' && action.lethal
      && (action.victimSquare ?? action.to) === survivor![0])).toBe(false)
  })

  it('protects its king instead of taking a low-value victim', () => {
    const state = position({
      a1: piece('k', 'w', 'wk', 1),
      d4: piece('q', 'w', 'wq'),
      a3: piece('r', 'b', 'br'),
      e4: piece('p', 'b', 'bait', 1),
      h8: piece('k', 'b', 'bk'),
    })
    const move = getBattleComputerMove(state, 2)
    expectLegal(state, move)
    const next = applyBattleAction(state, { from: move!.from as Square, to: move!.to as Square })!
    expect(battleActions(next).some((action) => action.kind === 'attack' && action.lethal
      && next.board[action.victimSquare ?? action.to]?.type === 'k')).toBe(false)
  })

  it('returns null when no legal actions exist', () => {
    const board: Partial<Record<Square, BattlePiece>> = {}
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank += 1) {
        const at = `${file}${rank}` as Square
        board[at] = piece('r', 'b', at)
      }
    }
    board.a1 = piece('k', 'w', 'wk')
    board.h8 = piece('k', 'b', 'bk')
    board.a2 = piece('n', 'b', 'block-file')
    board.b1 = piece('n', 'b', 'block-rank')
    const state = position(board, 'b')
    expect(validateBattle(state)).toBe(true)
    expect(battleActions(state)).toHaveLength(0)
    expect(getBattleComputerMove(state, 4)).toBeNull()
  })

  it('returns null for a completed battle', () => {
    const state = { ...createBattle(), winner: 'w' as const }
    delete state.board.e8
    expect(validateBattle(state)).toBe(true)
    expect(getBattleComputerMove(state, 4)).toBeNull()
  })

  it('does not change the state or any unit', () => {
    const state = freeze(createBattle())
    const before = JSON.stringify(state)
    expectLegal(state, getBattleComputerMove(state, 2))
    expect(JSON.stringify(state)).toBe(before)
  })

  it.each([NaN, Infinity, -Infinity, -100, 0, 1.7, 99])('clamps invalid level %s to a finite search', (level) => {
    const state = position({
      a1: piece('k', 'w', 'wk'),
      d4: piece('r', 'w', 'wr'),
      d5: piece('k', 'b', 'bk', 1),
    })
    expectLegal(state, getBattleComputerMove(state, level))
  })

  it('uses the same choice for the same tactical position', () => {
    const state = position({
      a1: piece('k', 'w', 'wk'),
      d4: piece('r', 'w', 'wr'),
      h8: piece('k', 'b', 'bk'),
      d5: piece('q', 'b', 'weak', 1),
    })
    expect(getBattleComputerMove(state, 1)).toEqual(getBattleComputerMove(state, 1))
  })
})

describe('battle input validation', () => {
  it('accepts a new battle and a battle after an action', () => {
    const state = createBattle()
    expect(validateBattle(state)).toBe(true)
    const action = battleActions(state)[0]
    expect(validateBattle(applyBattleAction(state, action))).toBe(true)
  })

  it.each([null, undefined, {}, [], 'invalid', { board: {}, turn: 'w' }])('rejects malformed state %s', (state) => {
    expect(validateBattle(state)).toBe(false)
    expect(getBattleComputerMove(state as BattleState, 1)).toBeNull()
  })

  it('rejects invalid health, squares, units, counters, and action history', () => {
    const state = createBattle()
    const malformed: unknown[] = [
      { ...state, turn: 'x' },
      { ...state, board: { ...state.board, z9: piece('p', 'w', 'invalid') } },
      { ...state, board: { ...state.board, a2: { ...state.board.a2, hp: NaN } } },
      { ...state, board: { ...state.board, a2: { ...state.board.a2, hp: -1 } } },
      { ...state, board: { ...state.board, a2: { ...state.board.a2, type: 'x' } } },
      { ...state, board: { ...state.board, a2: { ...state.board.a2, moved: null } } },
      { ...state, ply: Infinity },
      { ...state, quietTurns: -1 },
      { ...state, enPassant: 'z9' },
      { ...state, lastAction: {} },
      { ...state, board: {} },
    ]
    for (const candidate of malformed) {
      expect(validateBattle(candidate)).toBe(false)
      expect(getBattleComputerMove(candidate as BattleState, 1)).toBeNull()
    }
  })
})

describe('battle worker', () => {
  it('preserves request IDs and returns null for malformed messages', async () => {
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage: vi.fn(),
    }
    vi.stubGlobal('self', worker)
    await import('./battle.worker')
    const state = position({
      a1: piece('k', 'w', 'wk'),
      d4: piece('r', 'w', 'wr'),
      d5: piece('k', 'b', 'bk', 1),
    })
    worker.onmessage!({ data: { state, level: 2, requestId: 42 } } as MessageEvent<unknown>)
    expect(worker.postMessage).toHaveBeenLastCalledWith({ move: { from: 'd4', to: 'd5' }, requestId: 42 })
    worker.onmessage!({ data: { state: {}, level: 1, requestId: 43 } } as MessageEvent<unknown>)
    expect(worker.postMessage).toHaveBeenLastCalledWith({ move: null, requestId: 43 })
    for (const data of [null, undefined, {}, [], { state, level: 'wrong', requestId: 44 }]) {
      expect(() => worker.onmessage!({ data } as MessageEvent<unknown>)).not.toThrow()
      expect(worker.postMessage.mock.lastCall?.[0].move).toBeNull()
    }
  })
})
