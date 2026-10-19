import { Chess } from 'chess.js'
import type { Color, PieceSymbol, Square } from 'chess.js'

export const MAX_COMMAND = 10
export const START_COMMAND = 1
export const COMMAND_REGEN = 2
export const SURGE_REGEN = 3
export const SURGE_ROUND = 20
export const STATUS_ROUNDS = 2
export const HAND_SIZE = 4
export const MAX_PAWNS = 10

export type CardId =
  | 'recruit' | 'rally' | 'maneuver' | 'fortify'
  | 'expose' | 'assault' | 'bombard' | 'coronation'

export type CardRole = 'deploy' | 'support' | 'strike' | 'order'
export type TargetKind =
  | 'none' | 'deploy' | 'ownPawn' | 'ownPair'
  | 'ownPiece' | 'enemyPiece' | 'strikeTarget' | 'coronate'

export type CardDef = {
  id: CardId
  name: string
  cost: number
  role: CardRole
  target: TargetKind
  steps: 1 | 2
  headline: string
  rule: string
}

export const CARDS: Record<CardId, CardDef> = {
  recruit: {
    id: 'recruit', name: 'Recruit', cost: 3, role: 'deploy', target: 'deploy', steps: 1,
    headline: 'Deploy a pawn',
    rule: 'Place a new pawn on any empty square in your own half, not on the back rank. You cannot hold more than 10 pawns.',
  },
  rally: {
    id: 'rally', name: 'Rally', cost: 2, role: 'order', target: 'ownPawn', steps: 1,
    headline: 'Push a pawn',
    rule: 'Advance one of your pawns one square forward. The square must be empty. A pawn that reaches the last rank becomes a queen.',
  },
  maneuver: {
    id: 'maneuver', name: 'Maneuver', cost: 2, role: 'order', target: 'ownPair', steps: 2,
    headline: 'Swap two pieces',
    rule: 'Exchange the squares of two of your own pieces. Kings cannot be swapped, and no pawn may end on the back rank.',
  },
  fortify: {
    id: 'fortify', name: 'Fortify', cost: 2, role: 'support', target: 'ownPiece', steps: 1,
    headline: 'Guard a piece',
    rule: 'One of your pieces becomes Guarded for 2 rounds. Every capture attempt against it loses 30%. Guarding also clears an Exposed mark.',
  },
  expose: {
    id: 'expose', name: 'Expose', cost: 2, role: 'strike', target: 'enemyPiece', steps: 1,
    headline: 'Mark an enemy',
    rule: 'An enemy piece becomes Exposed for 2 rounds. Capture attempts against it gain 30%. Exposing also clears a Guard.',
  },
  assault: {
    id: 'assault', name: 'Assault', cost: 3, role: 'strike', target: 'none', steps: 1,
    headline: '+25% next capture',
    rule: 'Your next capture attempt this turn gains 25%. The order expires at the end of your turn if it is not used.',
  },
  bombard: {
    id: 'bombard', name: 'Bombard', cost: 5, role: 'strike', target: 'strikeTarget', steps: 1,
    headline: 'Destroy from range',
    rule: 'Remove an enemy pawn, knight, or bishop anywhere on the board. A Guarded piece blocks the strike.',
  },
  coronation: {
    id: 'coronation', name: 'Coronation', cost: 5, role: 'support', target: 'coronate', steps: 1,
    headline: 'Crown a pawn',
    rule: 'One of your pawns that has crossed into the enemy half becomes a queen at once.',
  },
}

export const DECK: CardId[] = [
  'recruit', 'rally', 'maneuver', 'fortify', 'expose', 'assault', 'bombard', 'coronation',
]

export type StatusKind = 'guarded' | 'exposed'

export type Status = {
  kind: StatusKind
  square: Square
  owner: Color
  by: Color
  expiresAtPly: number
}

export type TacticsState = {
  lastPly: number
  command: Record<Color, number>
  decks: Record<Color, CardId[]>
  statuses: Status[]
  assault: Record<Color, boolean>
  playedThisTurn: number
}

export type FloaterTone = 'good' | 'bad' | 'neutral' | 'command'

export type BoardFloat = { square: Square; text: string; tone: FloaterTone }

export type BoardOp =
  | { type: 'put'; square: Square; piece: PieceSymbol; color: Color }
  | { type: 'remove'; square: Square }

export type CardEffect = {
  id: CardId
  by: Color
  ply: number
  targets: Square[]
  text: string
  floats: BoardFloat[]
  ops: BoardOp[]
  kind: 'board' | 'order'
}

export type LogEntry = {
  key: string
  ply: number
  by: Color | 'system'
  tone: 'good' | 'bad' | 'neutral' | 'command'
  label: string
  detail?: string
  card?: CardId
}

export const FILES = 'abcdefgh'

export function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

export function rankOf(square: Square): number {
  return Number(square[1])
}

export function pieceName(type: PieceSymbol): string {
  return { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }[type]
}

function forwardSquare(square: Square, color: Color): Square | null {
  const rank = rankOf(square) + (color === 'w' ? 1 : -1)
  if (rank < 1 || rank > 8) return null
  return `${square[0]}${rank}` as Square
}

function deployRanks(color: Color): number[] {
  return color === 'w' ? [2, 3, 4] : [5, 6, 7]
}

function crownRanks(color: Color): number[] {
  return color === 'w' ? [5, 6, 7, 8] : [1, 2, 3, 4]
}

export function allSquares(): Square[] {
  return FILES.split('').flatMap((file) => [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => `${file}${rank}` as Square))
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createDeck(seed: string): CardId[] {
  const deck = [...DECK]
  let state = hashSeed(seed) || 1
  for (let index = deck.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const pick = state % (index + 1)
    const swap = deck[index]
    deck[index] = deck[pick]
    deck[pick] = swap
  }
  return deck
}

export function createTactics(seed: string, ply = 0): TacticsState {
  return {
    lastPly: ply,
    command: { w: START_COMMAND, b: START_COMMAND },
    decks: { w: createDeck(`${seed}:w`), b: createDeck(`${seed}:b`) },
    statuses: [],
    assault: { w: false, b: false },
    playedThisTurn: 0,
  }
}

export function handOf(state: TacticsState, color: Color): CardId[] {
  return state.decks[color].slice(0, HAND_SIZE)
}

export function nextOf(state: TacticsState, color: Color): CardId {
  return state.decks[color][HAND_SIZE]
}

export function regenFor(surge: boolean): number {
  return surge ? SURGE_REGEN : COMMAND_REGEN
}

export function beginTurn(state: TacticsState, color: Color, ply: number, surge: boolean): TacticsState {
  return {
    ...state,
    lastPly: ply,
    command: { ...state.command, [color]: Math.min(MAX_COMMAND, state.command[color] + regenFor(surge)) },
    assault: { ...state.assault, [color]: false },
    playedThisTurn: 0,
  }
}

export function roundsLeft(status: Status, ply: number): number {
  return Math.max(0, Math.ceil((status.expiresAtPly - ply) / 2))
}

export function syncStatuses(state: TacticsState, game: Chess, ply: number): TacticsState {
  const kept = state.statuses.filter((status) => (
    status.expiresAtPly > ply && game.get(status.square)?.color === status.owner
  ))
  return kept.length === state.statuses.length ? state : { ...state, statuses: kept }
}

export function statusAt(state: TacticsState, square: Square, kind: StatusKind): Status | undefined {
  return state.statuses.find((status) => status.square === square && status.kind === kind)
}

function kingSquare(game: Chess, color: Color): Square | null {
  return game.findPiece({ type: 'k', color })[0] ?? null
}

function kingIsSafe(game: Chess, color: Color): boolean {
  const square = kingSquare(game, color)
  if (!square) return false
  return (game.attackers(square, other(color)) ?? []).length === 0
}

/** Applies board operations to a chess.js position and returns the operations that undo them. */
export function applyOps(game: Chess, ops: BoardOp[]): BoardOp[] {
  const revert: BoardOp[] = []
  for (const op of ops) {
    const existing = game.get(op.square)
    revert.push(existing
      ? { type: 'put', square: op.square, piece: existing.type, color: existing.color }
      : { type: 'remove', square: op.square })
  }
  for (const op of ops) {
    if (op.type === 'put') game.put({ type: op.piece, color: op.color }, op.square)
    else game.remove(op.square)
  }
  return revert.reverse()
}

/** Replays a recorded card effect onto a position. Used for undo, review, and reload. */
export function applyEffect(game: Chess, effect: CardEffect): void {
  applyOps(game, effect.ops)
}

function pawnCount(game: Chess, color: Color): number {
  return game.findPiece({ type: 'p', color }).length
}

function ownPieces(game: Chess, color: Color, kinds: PieceSymbol[]): Square[] {
  return allSquares().filter((square) => {
    const piece = game.get(square)
    return piece?.color === color && kinds.includes(piece.type)
  })
}

function enemyPieces(game: Chess, color: Color, kinds: PieceSymbol[]): Square[] {
  return ownPieces(game, other(color), kinds)
}

function swapPlan(game: Chess, first: Square, second: Square): BoardOp[] {
  const a = game.get(first)
  const b = game.get(second)
  if (!a || !b) return []
  return [
    { type: 'put', square: second, piece: a.type, color: a.color },
    { type: 'put', square: first, piece: b.type, color: b.color },
  ]
}

function swapIsClean(game: Chess, first: Square, second: Square): boolean {
  const a = game.get(first)
  const b = game.get(second)
  if (!a || !b) return false
  if (a.type === 'k' || b.type === 'k') return false
  const putsPawnOnBackRank = (piece: { type: PieceSymbol }, square: Square) => (
    piece.type === 'p' && (rankOf(square) === 1 || rankOf(square) === 8)
  )
  return !putsPawnOnBackRank(a, second) && !putsPawnOnBackRank(b, first)
}

/** Squares a card may target. `first` is the already-chosen square for a two-step card. */
export function legalTargets(
  game: Chess,
  state: TacticsState,
  color: Color,
  card: CardId,
  first?: Square,
): Square[] {
  const def = CARDS[card]
  switch (def.target) {
    case 'none':
      return []
    case 'deploy': {
      if (pawnCount(game, color) >= MAX_PAWNS) return []
      const ranks = deployRanks(color)
      return allSquares().filter((square) => ranks.includes(rankOf(square)) && !game.get(square))
    }
    case 'ownPawn':
      return ownPieces(game, color, ['p']).filter((square) => {
        const to = forwardSquare(square, color)
        if (!to || game.get(to)) return false
        const promoted = rankOf(to) === (color === 'w' ? 8 : 1)
        return kingIsSafeAfter(game, color, [
          { type: 'remove', square },
          { type: 'put', square: to, piece: promoted ? 'q' : 'p', color },
        ])
      })
    case 'ownPiece':
      return ownPieces(game, color, ['p', 'n', 'b', 'r', 'q'])
    case 'ownPair': {
      const pool = ownPieces(game, color, ['p', 'n', 'b', 'r', 'q']).filter((square) => (
        first === undefined || (square !== first && swapIsClean(game, first, square))
      ))
      if (first === undefined) return pool
      return pool.filter((square) => kingIsSafeAfter(game, color, swapPlan(game, first, square)))
    }
    case 'enemyPiece':
      return enemyPieces(game, color, ['p', 'n', 'b', 'r', 'q'])
    case 'strikeTarget':
      return enemyPieces(game, color, ['p', 'n', 'b']).filter((square) => (
        !statusAt(state, square, 'guarded')
        && kingIsSafeAfter(game, color, [{ type: 'remove', square }])
      ))
    case 'coronate': {
      const ranks = crownRanks(color)
      return ownPieces(game, color, ['p']).filter((square) => ranks.includes(rankOf(square))
        && kingIsSafeAfter(game, color, [
          { type: 'remove', square },
          { type: 'put', square, piece: 'q', color },
        ]))
    }
    default:
      return []
  }
}

function kingIsSafeAfter(game: Chess, color: Color, ops: BoardOp[]): boolean {
  const sim = new Chess(game.fen())
  applyOps(sim, ops)
  return kingIsSafe(sim, color)
}

export function canAfford(state: TacticsState, color: Color, card: CardId): boolean {
  return state.command[color] >= CARDS[card].cost
}

export function isPlayable(game: Chess, state: TacticsState, color: Color, card: CardId): boolean {
  if (!canAfford(state, color, card)) return false
  if (card === 'assault') return !state.assault[color]
  if (CARDS[card].target === 'none') return true
  return legalTargets(game, state, color, card).length > 0
}

export function isSurge(game: Chess): boolean {
  const fullmove = Number(game.fen().split(' ')[5])
  return Number.isFinite(fullmove) && fullmove > SURGE_ROUND
}

export function playCard(
  game: Chess,
  state: TacticsState,
  color: Color,
  card: CardId,
  ply: number,
  targets: Square[],
): { state: TacticsState; effect: CardEffect } | null {
  const def = CARDS[card]
  const handIndex = state.decks[color].indexOf(card)
  if (handIndex < 0 || handIndex >= HAND_SIZE) return null
  if (!canAfford(state, color, card)) return null
  if (def.target === 'none') {
    if (card === 'assault' && state.assault[color]) return null
  } else {
    if (targets.length !== def.steps) return null
    if (def.steps === 2) {
      if (targets[0] === targets[1]) return null
      if (!legalTargets(game, state, color, card).includes(targets[0])) return null
    }
    if (!legalTargets(game, state, color, card, def.steps === 2 ? targets[0] : undefined).includes(targets[def.steps - 1])) return null
  }

  const result = applyCard(game, state, color, card, ply, targets)
  if (!result) return null

  const deck = [...state.decks[color]]
  deck.splice(handIndex, 1)
  deck.push(card)

  return {
    state: {
      ...result.state,
      lastPly: ply,
      command: { ...result.state.command, [color]: state.command[color] - def.cost },
      decks: { ...result.state.decks, [color]: deck },
      playedThisTurn: state.playedThisTurn + 1,
    },
    effect: {
      ...result.effect,
      text: result.effect.text.replaceAll('{side}', color === 'w' ? 'White' : 'Black'),
    },
  }
}

function applyCard(
  game: Chess,
  state: TacticsState,
  color: Color,
  card: CardId,
  ply: number,
  targets: Square[],
): { state: TacticsState; effect: CardEffect } | null {
  const base: CardEffect = {
    id: card, by: color, ply, targets, kind: 'board',
    text: '', floats: [], ops: [],
  }

  if (card === 'assault') {
    return {
      state: { ...state, assault: { ...state.assault, [color]: true } },
      effect: { ...base, kind: 'order', text: '{side} issues Assault. The next capture gains 25%.' },
    }
  }

  if (card === 'fortify' || card === 'expose') {
    const square = targets[0]
    const piece = game.get(square)
    if (!piece) return null
    const kind: StatusKind = card === 'fortify' ? 'guarded' : 'exposed'
    const statuses = [
      ...state.statuses.filter((status) => status.square !== square),
      { kind, square, owner: piece.color, by: color, expiresAtPly: ply + STATUS_ROUNDS * 2 },
    ]
    return {
      state: { ...state, statuses },
      effect: {
        ...base, kind: 'order',
        text: card === 'fortify'          ? `{side} fortifies the ${pieceName(piece.type).toLowerCase()} on ${square}. Guarded for 2 rounds.`
          : `{side} exposes the ${pieceName(piece.type).toLowerCase()} on ${square}. Captures against it gain 30%.`,
        floats: [{ square, text: card === 'fortify' ? 'GUARDED' : 'EXPOSED', tone: card === 'fortify' ? 'good' : 'bad' }],
      },
    }
  }

  const ops: BoardOp[] = []
  let text = ''
  const floats: BoardFloat[] = []

  if (card === 'recruit') {
    const square = targets[0]
    ops.push({ type: 'put', square, piece: 'p', color })
    text = `{side} recruits a pawn on ${square}.`
    floats.push({ square, text: 'DEPLOYED', tone: 'good' })
  } else if (card === 'rally') {
    const square = targets[0]
    const to = forwardSquare(square, color)
    if (!to) return null
    const promoted = rankOf(to) === (color === 'w' ? 8 : 1)
    ops.push({ type: 'remove', square }, { type: 'put', square: to, piece: promoted ? 'q' : 'p', color })
    text = promoted
      ? `{side} rallies the pawn from ${square} to ${to} and crowns a queen.`
      : `{side} rallies the pawn from ${square} to ${to}.`
    floats.push({ square: to, text: promoted ? 'QUEEN' : 'RALLY', tone: promoted ? 'command' : 'good' })
  } else if (card === 'maneuver') {
    const [first, second] = targets
    if (!swapIsClean(game, first, second)) return null
    const left = game.get(first)
    const right = game.get(second)
    ops.push(...swapPlan(game, first, second))
    text = left && right
      ? `{side} maneuvers the ${pieceName(left.type).toLowerCase()} on ${first} with the ${pieceName(right.type).toLowerCase()} on ${second}.`
      : `{side} maneuvers ${first} and ${second}.`
    floats.push({ square: first, text: 'SWAP', tone: 'neutral' }, { square: second, text: 'SWAP', tone: 'neutral' })
  } else if (card === 'bombard') {
    const square = targets[0]
    const piece = game.get(square)
    if (!piece || statusAt(state, square, 'guarded')) return null
    ops.push({ type: 'remove', square })
    text = `{side} bombards ${square} and destroys the ${pieceName(piece.type).toLowerCase()}.`
    floats.push({ square, text: 'DESTROYED', tone: 'bad' })
  } else if (card === 'coronation') {
    const square = targets[0]
    if (game.get(square)?.type !== 'p') return null
    ops.push({ type: 'remove', square }, { type: 'put', square, piece: 'q', color })
    text = `{side} crowns the pawn on ${square} as a queen.`
    floats.push({ square, text: 'QUEEN', tone: 'command' })
  } else {
    return null
  }

  const sim = new Chess(game.fen())
  applyOps(sim, ops)
  if (!kingIsSafe(sim, color)) return null
  applyOps(game, ops)

  return { state, effect: { ...base, text, floats, ops } }
}

/** Statuses that were in force at a given ply, rebuilt from the effect timeline. */
export function statusesAtPly(effects: CardEffect[], game: Chess, ply: number): Status[] {
  const statuses: Status[] = []
  for (const effect of effects) {
    if (effect.id !== 'fortify' && effect.id !== 'expose') continue
    if (effect.ply > ply || effect.ply + STATUS_ROUNDS * 2 <= ply) continue
    const square = effect.targets[0]
    const kind: StatusKind = effect.id === 'fortify' ? 'guarded' : 'exposed'
    const index = statuses.findIndex((status) => status.square === square)
    if (index >= 0) statuses.splice(index, 1)
    statuses.push({
      kind,
      square,
      owner: effect.id === 'fortify' ? effect.by : other(effect.by),
      by: effect.by,
      expiresAtPly: effect.ply + STATUS_ROUNDS * 2,
    })
  }
  return statuses.filter((status) => game.get(status.square)?.color === status.owner)
}
