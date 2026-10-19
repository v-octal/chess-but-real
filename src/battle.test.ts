import type { Color, PieceSymbol, Square } from 'chess.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNIT_STATS,
  applyBattleAction,
  battleActions,
  battleFen,
  battleOutcome,
  createBattle,
  damageAt,
  healthTotal,
  validateBattle,
} from './battle'
import type { BattlePiece, BattleState } from './battle'

function unit(type: PieceSymbol, color: Color = 'w', hp = UNIT_STATS[type].health, moved = false): Omit<BattlePiece, 'id'> {
  return { type, color, hp, moved }
}

function position(pieces: Partial<Record<Square, Omit<BattlePiece, 'id'>>>, turn: Color = 'w'): BattleState {
  const state = createBattle(`7k/8/8/8/8/8/8/7K ${turn} - - 0 1`)
  for (const [square, piece] of Object.entries(pieces)) {
    if (piece.type === 'k') {
      for (const [oldSquare, oldPiece] of Object.entries(state.board)) {
        if (oldPiece.type === 'k' && oldPiece.color === piece.color) delete state.board[oldSquare as Square]
      }
    }
    state.board[square as Square] = { ...piece, id: `${piece.color}${piece.type}-${square}` }
  }
  return state
}

function play(state: BattleState, from: Square, to: Square, promotion?: PieceSymbol): BattleState {
  const result = applyBattleAction(state, { from, to, ...(promotion ? { promotion } : {}) })
  expect(result).not.toBeNull()
  expect(validateBattle(result)).toBe(true)
  return result!
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('battle setup and serialization', () => {
  it('uses the required unit statistics', () => {
    expect(UNIT_STATS).toEqual({
      p: { name: 'Pawn', health: 100, damage: 35, range: 1, weapon: 'spear', weaponName: 'Spear' },
      n: { name: 'Knight', health: 180, damage: 65, range: 2, weapon: 'lance', weaponName: 'Lance' },
      b: { name: 'Bishop', health: 140, damage: 55, range: 7, weapon: 'bolt', weaponName: 'Bolt' },
      r: { name: 'Rook', health: 240, damage: 70, range: 7, weapon: 'cannon', weaponName: 'Cannon' },
      q: { name: 'Queen', health: 220, damage: 80, range: 7, weapon: 'beam', weaponName: 'Beam' },
      k: { name: 'King', health: 300, damage: 60, range: 1, weapon: 'sword', weaponName: 'Sword' },
    })
  })

  it('creates a full army with deterministic unique IDs and full health', () => {
    const state = createBattle()
    expect(state).toEqual(createBattle())
    expect(validateBattle(state)).toBe(true)
    expect(Object.keys(state.board)).toHaveLength(32)
    expect(new Set(Object.values(state.board).map((piece) => piece.id)).size).toBe(32)
    expect(healthTotal(state, 'w')).toEqual({ current: 2440, max: 2440 })
    expect(healthTotal(state, 'b')).toEqual({ current: 2440, max: 2440 })
    expect(state).toMatchObject({ turn: 'w', ply: 0, winner: null, lastAction: null, enPassant: null, quietTurns: 0 })
    expect(battleFen(state)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(battleActions(state)).toHaveLength(20)
    expect(battleOutcome(state)).toBeNull()
  })

  it('imports counters, castling rights, and en passant without check restrictions', () => {
    const fen = 'r3k2r/8/8/3pP3/8/8/8/R3K2R w Kq d6 0 10'
    const state = createBattle(fen)
    expect(state.ply).toBe(18)
    expect(state.board.e1?.moved).toBe(false)
    expect(state.board.h1?.moved).toBe(false)
    expect(state.board.a1?.moved).toBe(true)
    expect(state.board.e8?.moved).toBe(false)
    expect(state.board.a8?.moved).toBe(false)
    expect(state.board.h8?.moved).toBe(true)
    expect(battleFen(state)).toBe(fen)
    expect(battleFen(createBattle('8/8/8/8/8/8/4k3/4K3 b - - 7 12')))
      .toBe('8/8/8/8/8/8/4k3/4K3 b - - 7 12')
  })

  it('preserves the complete state through JSON', () => {
    const state = play(position({ a1: unit('r', 'w', 111), a4: unit('p', 'b') }), 'a1', 'a4')
    const restored: unknown = JSON.parse(JSON.stringify(state))
    expect(validateBattle(restored)).toBe(true)
    expect(restored).toEqual(state)
    expect(battleActions(restored as BattleState)).toEqual(battleActions(state))
    expect(healthTotal(state, 'w')).toEqual({ current: 411, max: 540 })
    expect(healthTotal(state, 'b')).toEqual({ current: 351, max: 400 })
  })

  it.each([
    '',
    '8/8/8/8/8/8/8/8 w - - 0 1',
    '7k/8/8/8/8/8/8/6KK w - - 0 1',
    '7k/8/8/8/8/8/8/7K x - - 0 1',
    '7k/8/8/8/8/8/8/7K w K - 0 1',
    '7k/8/8/8/8/8/8/7K w KK - 0 1',
    '7k/8/8/8/8/8/8/7K w - a4 0 1',
    '7k/8/8/8/8/8/8/7K w - d6 0 1',
    '7k/8/8/8/8/8/8/7K w - - -1 1',
    '7k/8/8/8/8/8/8/7K w - - 0 0',
    '7k/8/8/8/8/8/8/7K w - - 0 Infinity',
    '7k/8/8/8/8/8/8/7K w - - 0 999999999999999999',
    '7k/8/8/8/8/8/8/7K w - - 0 1 extra',
    '7k/8/8/8/8/8/8/6PK w - - 0 1',
    '9/8/8/8/8/8/8/7K w - - 0 1',
    '7k/8/8/8/8/8/8/6ZK w - - 0 1',
  ])('rejects invalid FEN %s', (fen) => {
    expect(() => createBattle(fen)).toThrow('Invalid battle FEN')
  })
})

describe('damage and attack geometry', () => {
  it.each([
    [1, 70, 0], [2, 60, 15], [3, 49, 30], [4, 39, 45], [5, 28, 60], [6, 25, 65], [50, 25, 65],
  ])('calculates rook damage at distance %i', (distance, damage, falloff) => {
    expect(damageAt('r', distance)).toEqual({ damage, falloff })
  })

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid distance %s', (distance) => {
    expect(() => damageAt('p', distance)).toThrow(RangeError)
  })

  it.each([
    { type: 'r', from: 'a1', to: 'a6', allowed: true, damage: 28 },
    { type: 'r', from: 'a1', to: 'a7', allowed: true, damage: 25 },
    { type: 'r', from: 'a1', to: 'a8', allowed: true, damage: 25 },
    { type: 'b', from: 'a1', to: 'f6', allowed: true, damage: 22 },
    { type: 'b', from: 'a1', to: 'g7', allowed: true, damage: 19 },
    { type: 'q', from: 'a1', to: 'g7', allowed: true, damage: 28 },
    { type: 'q', from: 'a1', to: 'h8', allowed: true, damage: 28 },
    { type: 'r', from: 'a1', to: 'b3', allowed: false, damage: 0 },
    { type: 'b', from: 'a1', to: 'a5', allowed: false, damage: 0 },
  ] as const)('bounds $type attacks by chess lines at $to', ({ type, from, to, allowed, damage }) => {
    const state = position({ [from]: unit(type), [to]: unit(to === 'h8' ? 'k' : 'n', 'b') })
    const action = battleActions(state, from).find((candidate) => candidate.to === to)
    if (allowed) expect(action).toMatchObject({ kind: 'attack', damage, distance: distanceBetweenForTest(from, to), support: 0 })
    else expect(action).toBeUndefined()
  })

  it.each([
    { type: 'r', from: 'a1', blocker: 'a3', target: 'a5' },
    { type: 'b', from: 'a1', blocker: 'c3', target: 'e5' },
    { type: 'q', from: 'b1', blocker: 'b3', target: 'b5' },
  ] as const)('stops $type rays at the first unit', ({ type, from, blocker, target }) => {
    for (const color of ['w', 'b'] as Color[]) {
      const state = position({ [from]: unit(type), [blocker]: unit('p', color), [target]: unit('n', 'b') })
      const actions = battleActions(state, from)
      expect(actions.some((action) => action.to === target)).toBe(false)
      expect(actions.some((action) => action.to === blocker)).toBe(color === 'b')
    }
  })

  it('uses knight jumps and Chebyshev distance two', () => {
    const state = position({ d4: unit('n'), e4: unit('p'), e5: unit('p'), f5: unit('p', 'b') })
    const actions = battleActions(state, 'd4')
    expect(actions).toHaveLength(8)
    expect(actions.find((action) => action.to === 'f5')).toMatchObject({ kind: 'attack', distance: 2, damage: 66, falloff: 15, support: 1 })
    expect(actions.every((action) => action.distance === 2)).toBe(true)
    expect(actions.some((action) => action.to === 'd6')).toBe(false)
    const alone = position({ d4: unit('n'), f5: unit('p', 'b') })
    expect(battleActions(alone, 'd4').find((action) => action.to === 'f5')).toMatchObject({ damage: 55, support: 0 })
  })

  it('limits king actions to neighbors without check restrictions', () => {
    const state = position({ d4: unit('k'), e5: unit('k', 'b') })
    expect(battleActions(state, 'd4')).toHaveLength(8)
    expect(battleActions(state, 'd4').find((action) => action.to === 'e5'))
      .toMatchObject({ kind: 'attack', damage: 60, distance: 1 })
    expect(applyBattleAction(state, { from: 'd4', to: 'd6' })).toBeNull()
    expect(play(state, 'd4', 'e4').board.e4?.type).toBe('k')
  })

  it.each(['w', 'b'] as Color[])('limits pawn attacks to one forward diagonal square for %s', (color) => {
    const from: Square = color === 'w' ? 'd4' : 'd5'
    const near: Square = color === 'w' ? 'e5' : 'e4'
    const far: Square = color === 'w' ? 'f6' : 'f3'
    const wrong: Square = color === 'w' ? 'c3' : 'c6'
    const enemy: Color = color === 'w' ? 'b' : 'w'
    const state = position({ [from]: unit('p', color), [far]: unit('n', enemy), [wrong]: unit('n', enemy) }, color)
    expect(battleActions(state, from).some((action) => action.to === far || action.to === wrong)).toBe(false)
    state.board[near] = { ...unit('p', enemy), id: `enemy-${near}` }
    expect(battleActions(state, from).find((action) => action.to === near)).toMatchObject({ kind: 'attack', damage: 35, distance: 1, falloff: 0 })
    expect(battleActions(state, from).some((action) => action.to === far)).toBe(false)
  })

  it('adds 20% of base damage for every ally that also attacks the target', () => {
    const lone = position({ a1: unit('r'), a5: unit('n', 'b') })
    expect(battleActions(lone, 'a1').find((action) => action.to === 'a5')).toMatchObject({ damage: 39, support: 0 })
    const one = position({ a1: unit('r'), b4: unit('p'), a5: unit('n', 'b') })
    expect(battleActions(one, 'a1').find((action) => action.to === 'a5')).toMatchObject({ damage: 46, support: 1 })
    const two = position({ a1: unit('r'), b4: unit('p'), c4: unit('n'), a5: unit('n', 'b') })
    expect(battleActions(two, 'a1').find((action) => action.to === 'a5')).toMatchObject({ damage: 54, support: 2 })
    expect(battleActions(two, 'b4').find((action) => action.to === 'a5')).toMatchObject({ damage: 49, support: 2, distance: 1 })
  })

  it('ignores allies whose line to the target is blocked', () => {
    const state = position({ a1: unit('r'), e1: unit('b'), c3: unit('p'), a5: unit('n', 'b') })
    expect(battleActions(state, 'a1').find((action) => action.to === 'a5')).toMatchObject({ damage: 39, support: 0 })
    const open = position({ a1: unit('r'), e1: unit('b'), a5: unit('n', 'b') })
    expect(battleActions(open, 'a1').find((action) => action.to === 'a5')).toMatchObject({ damage: 46, support: 1 })
  })

  it('does not let allies support attacks they could not make themselves', () => {
    const state = position({ a1: unit('r'), a3: unit('p'), a5: unit('n', 'b') })
    expect(battleActions(state, 'a1').some((action) => action.to === 'a5')).toBe(false)
    const side = position({ a1: unit('r'), b3: unit('p'), a5: unit('n', 'b') })
    expect(battleActions(side, 'a1').find((action) => action.to === 'a5')).toMatchObject({ support: 0 })
  })

  it('does not confuse diagonal pawn attacks with forward movement', () => {
    const state = position({ d4: unit('p'), d5: unit('p', 'b'), e5: unit('p', 'b'), g7: unit('n', 'b') })
    expect(battleActions(state, 'd4').map((action) => action.to)).toEqual(['e5'])
    expect(battleActions(state, 'h8')).toEqual([])
    expect(battleActions(state, 'a1')).toEqual([])
  })
})

function distanceBetweenForTest(from: Square, to: Square): number {
  return Math.max(Math.abs(from.charCodeAt(0) - to.charCodeAt(0)), Math.abs(Number(from[1]) - Number(to[1])))
}

describe('attack resolution and turns', () => {
  it.each([100, 60, 20, 1])('keeps pre-attack targetHp in previews and results for %i HP', (hp) => {
    const state = freeze(position({ a1: unit('r'), a3: unit('p', 'b', hp) }))
    const preview = battleActions(state, 'a1').find((action) => action.to === 'a3')!
    const damage = Math.min(60, hp)
    const remaining = hp - damage
    expect(preview).toMatchObject({ targetHp: hp, damage, distance: 2, falloff: 15, lethal: remaining === 0 })
    expect(preview.targetHp! - preview.damage).toBe(remaining)
    const next = play(state, 'a1', 'a3')
    expect(next.lastAction).toEqual(preview)
    expect(next.lastAction!.targetHp! - next.lastAction!.damage).toBe(remaining)
    const victim = Object.values(next.board).find((piece) => piece.id === state.board.a3!.id)
    expect(victim?.hp ?? 0).toBe(remaining)
    expect(state.board.a3!.hp).toBe(hp)
  })

  it('keeps both units in place after a nonlethal attack and consumes one turn', () => {
    const state = position({ a1: unit('r', 'w', 111), a4: unit('p', 'b') })
    state.quietTurns = 77
    const next = play(state, 'a1', 'a4')
    expect(next.board.a1).toEqual(state.board.a1)
    expect(next.board.a4?.hp).toBe(51)
    expect(next).toMatchObject({ turn: 'b', ply: 1, quietTurns: 0, winner: null, enPassant: null })
    expect(next.lastAction).toMatchObject({ from: 'a1', to: 'a4', kind: 'attack', damage: 49, targetHp: 100, lethal: false, ply: 1 })
    expect(applyBattleAction(next, { from: 'a1', to: 'a4' })).toBeNull()
    expect(battleActions(next).every((action) => action.color === 'b' && action.ply === 2)).toBe(true)
  })

  it('caps lethal damage and advances the attacker to the ranged target', () => {
    const state = position({ a1: unit('r', 'w', 31), a4: unit('p', 'b', 20) })
    const next = play(state, 'a1', 'a4')
    expect(next.board.a1).toBeUndefined()
    expect(next.board.a4).toEqual({ ...state.board.a1, hp: 31, moved: true })
    expect(next.lastAction).toMatchObject({ damage: 20, targetHp: 20, lethal: true, distance: 3, falloff: 30 })
    expect(Object.values(next.board).some((piece) => piece.id === state.board.a4?.id)).toBe(false)
  })

  it('never trusts client damage or action metadata', () => {
    const state = position({ a1: unit('r'), a4: unit('p', 'b') })
    const input = { from: 'a1', to: 'a4', damage: 9999, lethal: true, color: 'b', kind: 'move' }
    expect(applyBattleAction(state, input)).toEqual(applyBattleAction(state, { from: 'a1', to: 'a4' }))
    expect(applyBattleAction(state, input)?.board.a4?.hp).toBe(51)
  })

  it.each([
    { from: 'a0', to: 'a1' }, { from: 'A1', to: 'a4' }, { from: 'a1', to: 'z9' },
    { from: 'a1', to: 'a1' }, { from: 'a1', to: 'b2' }, { from: 'h8', to: 'h7' },
    { from: 'a1', to: 'a2', promotion: 'k' }, { from: 'a1', to: 'a2', promotion: 'q' },
    { from: 'a1', to: 'a2', promotion: 'Q' }, { from: 'b2', to: 'b3' },
  ])('rejects invalid input without mutation: %j', (input) => {
    const state = freeze(position({ a1: unit('r') }))
    const before = JSON.stringify(state)
    expect(applyBattleAction(state, input)).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })

  it('rejects malformed runtime input', () => {
    const state = createBattle()
    for (const input of [null, [], {}, 'e2e4', { from: 2, to: 'e4' }, { from: 'e2', to: 'e4', promotion: null }]) {
      expect(applyBattleAction(state, input as { from: string; to: string })).toBeNull()
    }
  })

  it('wins only after king HP reaches zero', () => {
    const state = position({ a1: unit('r'), a4: unit('k', 'b', 50) })
    const hit = play(state, 'a1', 'a4')
    expect(hit.board.a4?.hp).toBe(1)
    expect(hit.winner).toBeNull()
    expect(battleOutcome(hit)).toBeNull()
    const returnTurn = play(hit, 'a4', 'a5')
    const won = play(returnTurn, 'a1', 'a5')
    expect(won.winner).toBe('w')
    expect(won.board.a5?.type).toBe('r')
    expect(won.lastAction?.damage).toBe(1)
    expect(battleOutcome(won)).toBe('White wins')
    expect(battleActions(won)).toEqual([])
    expect(applyBattleAction(won, { from: 'h1', to: 'h2' })).toBeNull()
    expect(validateBattle(JSON.parse(JSON.stringify(won)))).toBe(true)
    expect(battleFen(won)).toBe('8/8/8/R7/8/8/8/7K b - - 0 2')
    expect(createBattle(battleFen(won)).winner).toBe('w')
  })

  it('supports a black victory and no insufficient-material draw', () => {
    const state = position({ d4: unit('k', 'w', 1), e5: unit('k', 'b') }, 'b')
    expect(battleOutcome(state)).toBeNull()
    expect(battleOutcome(play(state, 'e5', 'd4'))).toBe('Black wins')
  })
})

describe('movement, castling, and promotion', () => {
  it.each([
    { type: 'r', to: 'a8' }, { type: 'b', to: 'g7' }, { type: 'q', to: 'a8' },
  ] as const)('allows unlimited clear movement for $type', ({ type, to }) => {
    const state = position({ a1: unit(type, 'w', 17) })
    const next = play(state, 'a1', to)
    expect(next.board[to]).toEqual({ ...state.board.a1, moved: true })
    expect(next.lastAction).toMatchObject({ kind: 'move', damage: 0, falloff: 0, lethal: false })
    expect(next.quietTurns).toBe(1)
  })

  it.each(['w', 'b'] as Color[])('allows only empty initial pawn steps for %s', (color) => {
    const from: Square = color === 'w' ? 'e2' : 'e7'
    const one: Square = color === 'w' ? 'e3' : 'e6'
    const two: Square = color === 'w' ? 'e4' : 'e5'
    const state = position({ [from]: unit('p', color, 40) }, color)
    expect(battleActions(state, from).map((action) => action.to)).toEqual([one, two])
    const next = play(state, from, two)
    expect(next.board[two]?.hp).toBe(40)
    expect(next.enPassant).toBe(one)
    expect(next.quietTurns).toBe(0)
    expect(battleFen(next).split(' ')[3]).toBe(one)
    state.board[from]!.moved = true
    expect(battleActions(state, from).map((action) => action.to)).toEqual([one])
    state.board[one] = { ...unit('n', color === 'w' ? 'b' : 'w'), id: `block-${one}` }
    expect(battleActions(state, from)).toEqual([])
    delete state.board[one]
    state.board[from]!.moved = false
    state.board[two] = { ...unit('n', color), id: `block-${two}` }
    expect(battleActions(state, from).map((action) => action.to)).toEqual([one])
  })

  it.each([
    { color: 'w', from: 'e1', to: 'g1', rookFrom: 'h1', rookTo: 'f1', notation: 'O-O' },
    { color: 'w', from: 'e1', to: 'c1', rookFrom: 'a1', rookTo: 'd1', notation: 'O-O-O' },
    { color: 'b', from: 'e8', to: 'g8', rookFrom: 'h8', rookTo: 'f8', notation: 'O-O' },
    { color: 'b', from: 'e8', to: 'c8', rookFrom: 'a8', rookTo: 'd8', notation: 'O-O-O' },
  ] as const)('castles $color to $to and preserves both HP values', ({ color, from, to, rookFrom, rookTo, notation }) => {
    const state = createBattle(`r3k2r/8/8/8/8/8/8/R3K2R ${color} KQkq - 0 1`)
    state.board[from]!.hp = 123
    state.board[rookFrom]!.hp = 47
    const next = play(freeze(state), from, to)
    expect(next.board[from]).toBeUndefined()
    expect(next.board[rookFrom]).toBeUndefined()
    expect(next.board[to]).toEqual({ ...state.board[from], hp: 123, moved: true })
    expect(next.board[rookTo]).toEqual({ ...state.board[rookFrom], hp: 47, moved: true })
    expect(next.lastAction).toMatchObject({ kind: 'move', rookFrom, rookTo, notation, distance: 2 })
    expect(next.ply).toBe(state.ply + 1)
    expect(next.turn).not.toBe(color)
    expect(battleFen(next).split(' ')[2]).toBe(color === 'w' ? 'kq' : 'KQ')
  })

  it('allows castling in check and through attacked squares', () => {
    const state = createBattle('4rr1k/8/8/8/8/8/8/R3K2R w KQ - 0 1')
    expect(play(state, 'e1', 'g1').board.g1?.type).toBe('k')
    expect(play(state, 'e1', 'c1').board.c1?.type).toBe('k')
  })

  it('requires an unmoved home king and rook and a completely empty path', () => {
    const state = createBattle('7k/8/8/8/8/8/8/R3K2R w KQ - 0 1')
    state.board.e1!.moved = true
    expect(applyBattleAction(state, { from: 'e1', to: 'g1' })).toBeNull()
    state.board.e1!.moved = false
    state.board.h1!.moved = true
    expect(applyBattleAction(state, { from: 'e1', to: 'g1' })).toBeNull()
    state.board.h1!.moved = false
    state.board.h1!.color = 'b'
    expect(applyBattleAction(state, { from: 'e1', to: 'g1' })).toBeNull()
    state.board.h1!.color = 'w'
    for (const square of ['b1', 'c1', 'd1'] as Square[]) {
      state.board[square] = { ...unit('n'), id: `block-${square}` }
      expect(applyBattleAction(state, { from: 'e1', to: 'c1' })).toBeNull()
      delete state.board[square]
    }
    state.board.f1 = { ...unit('n', 'b'), id: 'block-f1' }
    expect(applyBattleAction(state, { from: 'e1', to: 'g1' })).toBeNull()
    delete state.board.f1
    state.board.d1 = state.board.e1
    delete state.board.e1
    expect(applyBattleAction(state, { from: 'd1', to: 'b1' })).toBeNull()
  })

  it('does not restore castling rights after a rook returns home', () => {
    let state = createBattle('4k3/8/8/8/8/8/8/4K2R w K - 0 1')
    state = play(state, 'h1', 'h2')
    state = play(state, 'e8', 'e7')
    state = play(state, 'h2', 'h1')
    state = play(state, 'e7', 'e8')
    expect(battleFen(state).split(' ')[2]).toBe('-')
    expect(applyBattleAction(state, { from: 'e1', to: 'g1' })).toBeNull()
  })

  describe.each(['w', 'b'] as Color[])('promotion for %s', (color) => {
    it.each(['q', 'r', 'b', 'n'] as PieceSymbol[])('rescales damaged pawn HP for %s and keeps its ID', (promotion) => {
      const from: Square = color === 'w' ? 'a7' : 'a2'
      const to: Square = color === 'w' ? 'a8' : 'a1'
      const state = position({ [from]: unit('p', color, 50) }, color)
      const next = play(state, from, to, promotion)
      expect(next.board[to]).toEqual({ ...state.board[from], type: promotion, hp: UNIT_STATS[promotion].health / 2, moved: true })
      expect(next.lastAction?.promotion).toBe(promotion)
      expect(next.quietTurns).toBe(0)
      expect(battleActions(state, from).filter((action) => action.to === to).map((action) => action.promotion))
        .toEqual(['q', 'r', 'b', 'n'])
    })
  })

  it('defaults to queen and keeps at least one HP on promotion', () => {
    const state = position({ a7: unit('p', 'w', 1) })
    expect(play(state, 'a7', 'a8').board.a8).toMatchObject({ type: 'q', hp: 2 })
    expect(play(state, 'a7', 'a8', 'b').board.a8).toMatchObject({ type: 'b', hp: 1 })
  })

  it('promotes on lethal attacks but not on stationary nonlethal attacks', () => {
    const state = position({ b7: unit('p', 'w', 50), c8: unit('n', 'b', 30) })
    const next = play(state, 'b7', 'c8', 'r')
    expect(next.board.b7).toBeUndefined()
    expect(next.board.c8).toMatchObject({ type: 'r', hp: 120 })
    expect(next.lastAction).toMatchObject({ damage: 30, lethal: true, promotion: 'r', piece: 'p' })
    state.board.c8!.hp = 80
    const hit = play(state, 'b7', 'c8')
    expect(hit.board.b7).toMatchObject({ type: 'p', hp: 50 })
    expect(hit.board.c8?.hp).toBe(45)
    expect(hit.lastAction?.promotion).toBeUndefined()
    expect(applyBattleAction(state, { from: 'b7', to: 'c8', promotion: 'q' })).toBeNull()
  })
})

describe('en passant', () => {
  it.each(['w', 'b'] as Color[])('resolves nonlethal and lethal en passant for %s', (color) => {
    const fen = color === 'w'
      ? '7k/8/8/3pP3/8/8/8/7K w - d6 0 10'
      : '7k/8/8/8/3Pp3/8/8/7K b - d3 0 10'
    const from: Square = color === 'w' ? 'e5' : 'e4'
    const to: Square = color === 'w' ? 'd6' : 'd3'
    const victim: Square = color === 'w' ? 'd5' : 'd4'
    const state = createBattle(fen)
    const action = battleActions(state, from).find((candidate) => candidate.to === to)
    expect(action).toMatchObject({ kind: 'attack', damage: 35, distance: 1, victimSquare: victim, lethal: false })
    const hit = play(freeze(JSON.parse(JSON.stringify(state)) as BattleState), from, to)
    expect(hit.board[from]).toEqual(state.board[from])
    expect(hit.board[victim]?.hp).toBe(65)
    expect(hit.board[to]).toBeUndefined()
    expect(hit.enPassant).toBeNull()
    expect(hit.turn).not.toBe(color)
    state.board[victim]!.hp = 12
    const killed = play(state, from, to)
    expect(killed.lastAction).toMatchObject({ damage: 12, lethal: true, victimSquare: victim })
    expect(killed.board[victim]).toBeUndefined()
    expect(killed.board[from]).toBeUndefined()
    expect(killed.board[to]).toEqual({ ...state.board[from], moved: true })
  })

  it('expires en passant after any other action', () => {
    const state = createBattle('7k/8/8/3pP3/8/8/8/7K w - d6 0 10')
    const next = play(state, 'h1', 'g1')
    expect(next.enPassant).toBeNull()
    expect(battleFen(next).split(' ')[3]).toBe('-')
  })
})

describe('draws', () => {
  it('draws after 100 quiet turns and rejects more actions', () => {
    const state = position({ a1: unit('r') })
    state.quietTurns = 99
    const drawn = play(state, 'a1', 'a2')
    expect(drawn.quietTurns).toBe(100)
    expect(drawn.winner).toBeNull()
    expect(battleOutcome(drawn)).toBe('Draw: no progress (100 quiet turns)')
    expect(battleActions(drawn)).toEqual([])
    expect(applyBattleAction(drawn, { from: 'h8', to: 'h7' })).toBeNull()
  })

  it('resets the quiet counter on pawn moves and all attacks', () => {
    const pawn = position({ a2: unit('p') })
    pawn.quietTurns = 99
    expect(play(pawn, 'a2', 'a3').quietTurns).toBe(0)
    for (const hp of [100, 1]) {
      const attack = position({ a1: unit('r'), a4: unit('p', 'b', hp) })
      attack.quietTurns = 99
      expect(play(attack, 'a1', 'a4').quietTurns).toBe(0)
    }
  })

  it('draws when the current army has no actions without declaring a winner', () => {
    const state = position({ a1: unit('k') })
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank += 1) {
        const square = `${file}${rank}` as Square
        if (square === 'a1' || square === 'h8') continue
        state.board[square] = { ...unit(square === 'g7' ? 'r' : 'b'), id: `blocked-${square}` }
      }
    }
    expect(validateBattle(state)).toBe(true)
    expect(battleActions(state)).toEqual([])
    expect(state.winner).toBeNull()
    expect(battleOutcome(state)).toBe('Draw: stalemate (no legal actions)')
    expect(applyBattleAction(state, { from: 'a1', to: 'a2' })).toBeNull()
  })
})

describe('validation', () => {
  it.each([null, undefined, 0, '', [], {}, new Date(), { board: {} }])('rejects malformed states: %j', (value) => {
    expect(validateBattle(value)).toBe(false)
  })

  const corruptions: { name: string; mutate: (state: BattleState) => void }[] = [
    { name: 'invalid turn', mutate: (state) => { Object.assign(state, { turn: 'x' }) } },
    { name: 'negative ply', mutate: (state) => { state.ply = -1 } },
    { name: 'fractional ply', mutate: (state) => { state.ply = 0.5 } },
    { name: 'unsafe ply', mutate: (state) => { state.ply = Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'wrong turn parity', mutate: (state) => { state.turn = 'b' } },
    { name: 'negative quiet counter', mutate: (state) => { state.quietTurns = -1 } },
    { name: 'infinite quiet counter', mutate: (state) => { state.quietTurns = Infinity } },
    { name: 'NaN HP', mutate: (state) => { state.board.h1!.hp = NaN } },
    { name: 'zero HP', mutate: (state) => { state.board.h1!.hp = 0 } },
    { name: 'negative HP', mutate: (state) => { state.board.h1!.hp = -1 } },
    { name: 'fractional HP', mutate: (state) => { state.board.h1!.hp = 1.5 } },
    { name: 'excess HP', mutate: (state) => { state.board.h1!.hp = 301 } },
    { name: 'wrong piece type', mutate: (state) => { Object.assign(state.board.h1!, { type: 'x' }) } },
    { name: 'wrong piece color', mutate: (state) => { Object.assign(state.board.h1!, { color: 'white' }) } },
    { name: 'wrong moved flag', mutate: (state) => { Object.assign(state.board.h1!, { moved: 0 }) } },
    { name: 'empty ID', mutate: (state) => { state.board.h1!.id = '' } },
    { name: 'duplicate ID', mutate: (state) => { state.board.h1!.id = state.board.h8!.id } },
    { name: 'missing king', mutate: (state) => { delete state.board.h8 } },
    { name: 'duplicate king', mutate: (state) => { state.board.a1 = { ...unit('k'), id: 'extra-king' } } },
    { name: 'false winner', mutate: (state) => { state.winner = 'w' } },
    { name: 'invalid winner', mutate: (state) => { Object.assign(state, { winner: 'draw' }) } },
    { name: 'invalid square', mutate: (state) => { Object.assign(state.board, { z9: { ...unit('p'), id: 'z9' } }) } },
    { name: 'null piece', mutate: (state) => { Object.assign(state.board, { a2: null }) } },
    { name: 'undefined piece', mutate: (state) => { Object.assign(state.board, { a2: undefined }) } },
    { name: 'unpromoted pawn', mutate: (state) => { state.board.a8 = { ...unit('p'), id: 'bad-pawn' } } },
    { name: 'invalid en passant', mutate: (state) => { state.enPassant = 'd6' } },
    { name: 'extra state data', mutate: (state) => { Object.assign(state, { extra: () => 1 }) } },
    { name: 'extra piece data', mutate: (state) => { Object.assign(state.board.h1!, { extra: true }) } },
    { name: 'missing last action', mutate: (state) => { Reflect.deleteProperty(state, 'lastAction') } },
    { name: 'malformed last action', mutate: (state) => { Object.assign(state, { lastAction: {} }) } },
  ]

  it.each(corruptions)('rejects $name', ({ mutate }) => {
    const state = position({})
    mutate(state)
    expect(validateBattle(state)).toBe(false)
  })

  it('checks last-action metadata and the resulting board', () => {
    const state = play(position({ a1: unit('r'), a4: unit('p', 'b') }), 'a1', 'a4')
    for (const [key, value] of Object.entries({
      damage: 100, distance: 4, falloff: 0, support: 1, lethal: true, targetHp: 99,
      color: 'b', piece: 'b', target: 'n', from: 'a2', to: 'a5', ply: 0,
      kind: 'capture', notation: '', promotion: 'q', rookFrom: 'h1', victimSquare: 'a3',
    })) {
      const corrupted = structuredClone(state)
      Object.assign(corrupted.lastAction!, { [key]: value })
      expect(validateBattle(corrupted), key).toBe(false)
    }
    state.board.a4!.hp += 1
    expect(validateBattle(state)).toBe(false)
  })

  it('rejects unsafe object shapes without invoking accessors', () => {
    const state = position({})
    const getter = vi.fn(() => 'w')
    Object.defineProperty(state, 'turn', { get: getter, enumerable: true })
    expect(validateBattle(state)).toBe(false)
    expect(getter).not.toHaveBeenCalled()
    expect(validateBattle(Object.assign(Object.create({ inherited: true }), createBattle()))).toBe(false)
    const symbolState = Object.assign(createBattle(), { [Symbol('extra')]: true })
    expect(validateBattle(symbolState)).toBe(false)
    const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('Invalid object') } })
    expect(validateBattle(proxy)).toBe(false)
    const pollutedBoard = JSON.parse('{"__proto__":{}}') as unknown
    expect(validateBattle({ ...createBattle(), board: pollutedBoard })).toBe(false)
  })

  it('checks en passant victims, rank, and the previous double move', () => {
    const state = play(position({ e2: unit('p') }), 'e2', 'e4')
    for (const mutate of [
      (value: BattleState) => { value.board.e4!.moved = false },
      (value: BattleState) => { value.quietTurns = 1 },
      (value: BattleState) => { value.enPassant = 'e6' },
      (value: BattleState) => { value.enPassant = null },
      (value: BattleState) => { value.board.e2 = { ...unit('n'), id: 'bad-source' } },
      (value: BattleState) => { value.board.e3 = { ...unit('n'), id: 'bad-target' } },
    ]) {
      const corrupted = structuredClone(state)
      mutate(corrupted)
      expect(validateBattle(corrupted)).toBe(false)
    }
  })
})

describe('determinism, immutability, and HP invariants', () => {
  it('never uses randomness for setup, action generation, or resolution', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected randomness') })
    const cryptoRandom = vi.fn(() => { throw new Error('Unexpected crypto randomness') })
    vi.stubGlobal('crypto', { getRandomValues: cryptoRandom, randomUUID: cryptoRandom })
    const first = createBattle()
    const second = createBattle()
    expect(first).toEqual(second)
    expect(battleActions(first)).toEqual(battleActions(second))
    expect(play(first, 'e2', 'e4')).toEqual(play(second, 'e2', 'e4'))
    const attack = position({ a1: unit('r'), a4: unit('p', 'b') })
    expect(play(attack, 'a1', 'a4')).toEqual(play(attack, 'a1', 'a4'))
    expect(random).not.toHaveBeenCalled()
    expect(cryptoRandom).not.toHaveBeenCalled()
  })

  it('does not mutate or share mutable pieces with the source state', () => {
    const state = freeze(position({ a1: unit('r'), a4: unit('p', 'b') }))
    const before = JSON.stringify(state)
    const actions = battleActions(state)
    actions[0].damage = 9999
    const result = play(state, 'a1', 'a4')
    expect(JSON.stringify(state)).toBe(before)
    expect(result.board).not.toBe(state.board)
    for (const square of Object.keys(result.board) as Square[]) expect(result.board[square]).not.toBe(state.board[square])
    result.board.a1!.hp = 1
    result.board.h1!.hp = 1
    result.lastAction!.damage = 1
    expect(JSON.stringify(state)).toBe(before)
    expect(play(state, 'a1', 'a4').lastAction?.damage).toBe(49)
  })

  it('keeps stable IDs, integer HP bounds, and no healing over a deterministic game', () => {
    let state = createBattle()
    for (let index = 0; index < 200; index += 1) {
      const actions = battleActions(state)
      if (!actions.length) break
      const action = actions[(index * 17 + 7) % actions.length]
      const before = new Map(Object.values(state.board).map((piece) => [piece.id, { ...piece }]))
      const next = play(freeze(state), action.from, action.to, action.promotion)
      expect(next.ply).toBe(state.ply + 1)
      expect(next.turn).not.toBe(state.turn)
      const ids = Object.values(next.board).map((piece) => piece.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const piece of Object.values(next.board)) {
        const previous = before.get(piece.id)
        expect(previous).toBeDefined()
        expect(Number.isInteger(piece.hp)).toBe(true)
        expect(piece.hp).toBeGreaterThan(0)
        expect(piece.hp).toBeLessThanOrEqual(UNIT_STATS[piece.type].health)
        if (previous!.type === piece.type) expect(piece.hp).toBeLessThanOrEqual(previous!.hp)
        else expect(piece.hp).toBe(Math.max(1, Math.round(previous!.hp * UNIT_STATS[piece.type].health / UNIT_STATS[previous!.type].health)))
      }
      state = next
    }
    expect(state.ply).toBeGreaterThan(20)
  })
})
