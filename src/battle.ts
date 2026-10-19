import type { Color, PieceSymbol, Square } from 'chess.js'

export type Weapon = 'spear' | 'lance' | 'bolt' | 'cannon' | 'beam' | 'sword'

export const UNIT_STATS: Record<PieceSymbol, { name: string; health: number; damage: number; range: number; weapon: Weapon; weaponName: string }> = {
  p: { name: 'Pawn', health: 100, damage: 35, range: 1, weapon: 'spear', weaponName: 'Spear' },
  n: { name: 'Knight', health: 180, damage: 65, range: 2, weapon: 'lance', weaponName: 'Lance' },
  b: { name: 'Bishop', health: 140, damage: 55, range: 7, weapon: 'bolt', weaponName: 'Arcane bolt' },
  r: { name: 'Rook', health: 240, damage: 70, range: 7, weapon: 'cannon', weaponName: 'Cannon' },
  q: { name: 'Queen', health: 220, damage: 80, range: 7, weapon: 'beam', weaponName: 'Royal beam' },
  k: { name: 'King', health: 300, damage: 60, range: 1, weapon: 'sword', weaponName: 'Sword' },
}

export const SUPPORT_BONUS = 20

export type BattlePiece = { id: string; type: PieceSymbol; color: Color; hp: number; moved: boolean }
export type BattleBoard = Partial<Record<Square, BattlePiece>>
export type BattleAction = {
  from: Square
  to: Square
  kind: 'move' | 'attack'
  damage: number
  distance: number
  falloff: number
  support: number
  lethal: boolean
  piece: PieceSymbol
  color: Color
  target?: PieceSymbol
  targetHp?: number
  promotion?: PieceSymbol
  notation: string
  ply: number
  rookFrom?: Square
  rookTo?: Square
  victimSquare?: Square
}
export type BattleState = {
  board: BattleBoard
  turn: Color
  ply: number
  winner: Color | null
  lastAction: BattleAction | null
  enPassant: Square | null
  quietTurns: number
}

const FILES = 'abcdefgh'
const TYPES = ['p', 'n', 'b', 'r', 'q', 'k'] as const
const PROMOTIONS: PieceSymbol[] = ['q', 'r', 'b', 'n']
const SQUARES: Square[] = Array.from({ length: 64 }, (_, index) => (
  `${FILES[index % 8]}${8 - Math.floor(index / 8)}` as Square
))
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const ORTHOGONALS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value)
}

function isType(value: unknown): value is PieceSymbol {
  return typeof value === 'string' && TYPES.some((type) => type === value)
}

function isColor(value: unknown): value is Color {
  return value === 'w' || value === 'b'
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && descriptor?.enumerable && 'value' in descriptor
  })
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

function squareAt(file: number, rank: number): Square | null {
  return file >= 0 && file < 8 && rank >= 1 && rank <= 8 ? `${FILES[file]}${rank}` as Square : null
}

function distanceBetween(from: Square, to: Square): number {
  return Math.max(Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])), Math.abs(Number(from[1]) - Number(to[1])))
}

function castleSquares(color: Color, kingSide: boolean) {
  const rank = color === 'w' ? '1' : '8'
  return {
    from: `e${rank}` as Square,
    to: `${kingSide ? 'g' : 'c'}${rank}` as Square,
    rookFrom: `${kingSide ? 'h' : 'a'}${rank}` as Square,
    rookTo: `${kingSide ? 'f' : 'd'}${rank}` as Square,
    path: (kingSide ? ['f', 'g'] : ['b', 'c', 'd']).map((file) => `${file}${rank}` as Square),
  }
}

function castlingRights(board: BattleBoard): string {
  let rights = ''
  for (const color of ['w', 'b'] as Color[]) {
    for (const kingSide of [true, false]) {
      const { from, rookFrom } = castleSquares(color, kingSide)
      const king = board[from]
      const rook = board[rookFrom]
      if (king?.type === 'k' && king.color === color && !king.moved
        && rook?.type === 'r' && rook.color === color && !rook.moved) {
        const right = kingSide ? 'k' : 'q'
        rights += color === 'w' ? right.toUpperCase() : right
      }
    }
  }
  return rights || '-'
}

export function createBattle(fen = DEFAULT_FEN): BattleState {
  if (typeof fen !== 'string') throw new Error('Invalid battle FEN')
  const parts = fen.trim().split(/\s+/)
  const [placement, turn, rights, enPassant, quiet, full] = parts
  if (parts.length !== 6 || !isColor(turn) || !/^(?:-|[KQkq]+)$/.test(rights)
    || (rights !== '-' && new Set(rights).size !== rights.length)
    || !/^\d+$/.test(quiet) || !/^[1-9]\d*$/.test(full)) throw new Error('Invalid battle FEN')
  const rows = placement.split('/')
  if (rows.length !== 8) throw new Error('Invalid battle FEN')
  const board: BattleBoard = {}
  for (let row = 0; row < 8; row += 1) {
    let file = 0
    for (const symbol of rows[row]) {
      if (/^[1-8]$/.test(symbol)) {
        file += Number(symbol)
      } else {
        const type = symbol.toLowerCase()
        const square = squareAt(file, 8 - row)
        if (!isType(type) || !square) throw new Error('Invalid battle FEN')
        const color = symbol === type ? 'b' : 'w'
        board[square] = {
          id: `${color}${type}-${square}`,
          type,
          color,
          hp: UNIT_STATS[type].health,
          moved: type === 'k' || type === 'r' || (type === 'p' && square[1] !== (color === 'w' ? '2' : '7')),
        }
        file += 1
      }
      if (file > 8) throw new Error('Invalid battle FEN')
    }
    if (file !== 8) throw new Error('Invalid battle FEN')
  }
  if (rights !== '-') {
    for (const right of rights) {
      const color = right === right.toUpperCase() ? 'w' : 'b'
      const { from, rookFrom } = castleSquares(color, right.toLowerCase() === 'k')
      const king = board[from]
      const rook = board[rookFrom]
      if (king?.type !== 'k' || king.color !== color || rook?.type !== 'r' || rook.color !== color) {
        throw new Error('Invalid battle FEN')
      }
      king.moved = false
      rook.moved = false
    }
  }
  const pieces = Object.values(board)
  const whiteKing = pieces.some((piece) => piece.type === 'k' && piece.color === 'w')
  const blackKing = pieces.some((piece) => piece.type === 'k' && piece.color === 'b')
  const state: BattleState = {
    board,
    turn,
    ply: (Number(full) - 1) * 2 + (turn === 'b' ? 1 : 0),
    winner: whiteKing && blackKing ? null : whiteKing ? 'w' : blackKing ? 'b' : null,
    lastAction: null,
    enPassant: enPassant === '-' ? null : enPassant as Square,
    quietTurns: Number(quiet),
  }
  if (!validateBattle(state)) throw new Error('Invalid battle FEN')
  return state
}

export function damageAt(type: PieceSymbol, distance: number, support = 0): { damage: number; falloff: number } {
  if (!integer(distance, 1)) throw new RangeError('Distance must be a positive integer')
  if (!integer(support)) throw new RangeError('Support must be a non-negative integer')
  const multiplier = Math.max(0.35, 1 - 0.15 * (distance - 1))
  const boosted = multiplier * (1 + SUPPORT_BONUS / 100 * support)
  return {
    damage: Math.max(1, Math.round(UNIT_STATS[type].damage * boosted)),
    falloff: Math.round((1 - multiplier) * 100),
  }
}

function attackReach(board: BattleBoard, origin: Square): Square[] {
  const piece = board[origin]
  if (!piece) return []
  const file = FILES.indexOf(origin[0])
  const rank = Number(origin[1])
  const reach: Square[] = []
  if (piece.type === 'p') {
    const forward = piece.color === 'w' ? 1 : -1
    for (const side of [-1, 1]) {
      const to = squareAt(file + side, rank + forward)
      if (to) reach.push(to)
    }
    return reach
  }
  if (piece.type === 'n' || piece.type === 'k') {
    const offsets = piece.type === 'n'
      ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
      : [...ORTHOGONALS, ...DIAGONALS]
    for (const [dx, dy] of offsets) {
      const to = squareAt(file + dx, rank + dy)
      if (to) reach.push(to)
    }
    return reach
  }
  const directions = piece.type === 'b' ? DIAGONALS : piece.type === 'r' ? ORTHOGONALS : [...ORTHOGONALS, ...DIAGONALS]
  for (const [dx, dy] of directions) {
    for (let step = 1; step <= UNIT_STATS[piece.type].range; step += 1) {
      const to = squareAt(file + dx * step, rank + dy * step)
      if (!to) break
      reach.push(to)
      if (board[to]) break
    }
  }
  return reach
}

export function supportFor(board: BattleBoard, attacker: Square, target: Square): number {
  const piece = board[attacker]
  if (!piece) return 0
  let count = 0
  for (const square of SQUARES) {
    if (square === attacker) continue
    const ally = board[square]
    if (!ally || ally.color !== piece.color) continue
    if (attackReach(board, square).includes(target)) count += 1
  }
  return count
}

function addAction(
  actions: BattleAction[],
  state: BattleState,
  from: Square,
  to: Square,
  extra: Pick<BattleAction, 'rookFrom' | 'rookTo' | 'victimSquare'> = {},
): void {
  const piece = state.board[from]!
  const target = state.board[extra.victimSquare ?? to]
  const distance = distanceBetween(from, to)
  const support = target ? supportFor(state.board, from, extra.victimSquare ?? to) : 0
  const hit = target ? damageAt(piece.type, distance, support) : { damage: 0, falloff: 0 }
  const damage = target ? Math.min(target.hp, hit.damage) : 0
  const lethal = Boolean(target && damage === target.hp)
  const promotions = piece.type === 'p' && to[1] === (piece.color === 'w' ? '8' : '1') && (!target || lethal)
    ? PROMOTIONS : [undefined]
  for (const promotion of promotions) {
    const notation = extra.rookFrom
      ? to[0] === 'g' ? 'O-O' : 'O-O-O'
      : `${piece.type.toUpperCase()}${from}${target ? 'x' : '-'}${to}${promotion ? `=${promotion.toUpperCase()}` : ''}${target ? ` (${damage} HP${support ? `, +${support}` : ''}${lethal ? ', lethal' : ''})` : ''}`
    actions.push({
      from,
      to,
      kind: target ? 'attack' : 'move',
      damage,
      distance,
      falloff: hit.falloff,
      support,
      lethal,
      piece: piece.type,
      color: piece.color,
      notation,
      ply: state.ply + 1,
      ...extra,
      ...(target ? { target: target.type, targetHp: target.hp } : {}),
      ...(promotion ? { promotion } : {}),
    })
  }
}

export function battleActions(state: BattleState, from?: Square): BattleAction[] {
  if (state.winner || state.quietTurns >= 100 || state.ply >= Number.MAX_SAFE_INTEGER) return []
  const actions: BattleAction[] = []
  for (const origin of from === undefined ? SQUARES : isSquare(from) ? [from] : []) {
    const piece = state.board[origin]
    if (!piece || piece.color !== state.turn) continue
    const file = FILES.indexOf(origin[0])
    const rank = Number(origin[1])
    if (piece.type === 'p') {
      const forward = piece.color === 'w' ? 1 : -1
      const one = squareAt(file, rank + forward)
      if (one && !state.board[one]) {
        addAction(actions, state, origin, one)
        const two = squareAt(file, rank + forward * 2)
        if (!piece.moved && rank === (piece.color === 'w' ? 2 : 7) && two && !state.board[two]) {
          addAction(actions, state, origin, two)
        }
      }
      for (const side of [-1, 1]) {
        const to = squareAt(file + side, rank + forward)
        if (!to) continue
        const target = state.board[to]
        if (target) {
          if (target.color !== piece.color) addAction(actions, state, origin, to)
          continue
        }
        if (to === state.enPassant) {
          const victimSquare = squareAt(file + side, rank)!
          const victim = state.board[victimSquare]
          if (victim?.type === 'p' && victim.color !== piece.color && victim.moved
            && rank === (piece.color === 'w' ? 5 : 4)) {
            addAction(actions, state, origin, to, { victimSquare })
          }
        }
      }
      continue
    }
    if (piece.type === 'n' || piece.type === 'k') {
      const offsets = piece.type === 'n'
        ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
        : [...ORTHOGONALS, ...DIAGONALS]
      for (const [dx, dy] of offsets) {
        const to = squareAt(file + dx, rank + dy)
        if (to && state.board[to]?.color !== piece.color) addAction(actions, state, origin, to)
      }
      if (piece.type === 'k' && !piece.moved) {
        for (const kingSide of [true, false]) {
          const castle = castleSquares(piece.color, kingSide)
          const rook = state.board[castle.rookFrom]
          if (origin === castle.from && rook?.type === 'r' && rook.color === piece.color && !rook.moved
            && castle.path.every((square) => !state.board[square])) {
            addAction(actions, state, origin, castle.to, { rookFrom: castle.rookFrom, rookTo: castle.rookTo })
          }
        }
      }
      continue
    }
    const directions = piece.type === 'b' ? DIAGONALS : piece.type === 'r' ? ORTHOGONALS : [...ORTHOGONALS, ...DIAGONALS]
    for (const [dx, dy] of directions) {
      for (let step = 1; step <= 7; step += 1) {
        const to = squareAt(file + dx * step, rank + dy * step)
        if (!to) break
        const target = state.board[to]
        if (target) {
          if (target.color !== piece.color && step <= UNIT_STATS[piece.type].range) addAction(actions, state, origin, to)
          break
        }
        addAction(actions, state, origin, to)
      }
    }
  }
  return actions
}

export function applyBattleAction(
  state: BattleState,
  input: { from: string; to: string; promotion?: string },
): BattleState | null {
  if (!validateBattle(state) || !record(input) || !isSquare(input.from) || !isSquare(input.to)
    || (input.promotion !== undefined && !PROMOTIONS.includes(input.promotion as PieceSymbol))) return null
  const action = battleActions(state, input.from).find((candidate) => candidate.to === input.to
    && candidate.promotion === (input.promotion ?? (candidate.promotion ? 'q' : undefined)))
  if (!action) return null
  const board: BattleBoard = {}
  for (const square of SQUARES) {
    const piece = state.board[square]
    if (piece) board[square] = { ...piece }
  }
  const piece = board[action.from]!
  if (action.kind === 'attack') {
    const victimSquare = action.victimSquare ?? action.to
    const target = board[victimSquare]!
    target.hp -= action.damage
    if (action.lethal) delete board[victimSquare]
  }
  if (action.kind === 'move' || action.lethal) {
    delete board[action.from]
    piece.moved = true
    if (action.promotion) {
      piece.hp = Math.max(1, Math.round(piece.hp * UNIT_STATS[action.promotion].health / UNIT_STATS.p.health))
      piece.type = action.promotion
    }
    board[action.to] = piece
    if (action.rookFrom && action.rookTo) {
      const rook = board[action.rookFrom]!
      delete board[action.rookFrom]
      board[action.rookTo] = { ...rook, moved: true }
    }
  }
  return {
    board,
    turn: other(state.turn),
    ply: state.ply + 1,
    winner: action.lethal && action.target === 'k' ? state.turn : null,
    lastAction: action,
    enPassant: action.piece === 'p' && action.kind === 'move' && action.distance === 2
      ? `${action.from[0]}${(Number(action.from[1]) + Number(action.to[1])) / 2}` as Square : null,
    quietTurns: action.kind === 'attack' || action.piece === 'p' ? 0 : state.quietTurns + 1,
  }
}

export function battleFen(state: BattleState): string {
  const rows: string[] = []
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = ''
    let empty = 0
    for (const file of FILES) {
      const piece = state.board[`${file}${rank}` as Square]
      if (!piece) {
        empty += 1
      } else {
        if (empty) row += empty
        empty = 0
        row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type
      }
    }
    rows.push(row + (empty || ''))
  }
  return `${rows.join('/')} ${state.turn} ${castlingRights(state.board)} ${state.enPassant ?? '-'} ${state.quietTurns} ${Math.floor(state.ply / 2) + 1}`
}

export function healthTotal(state: BattleState, color: Color): { current: number; max: number } {
  return Object.values(state.board).reduce((total, piece) => piece.color === color ? {
    current: total.current + piece.hp,
    max: total.max + UNIT_STATS[piece.type].health,
  } : total, { current: 0, max: 0 })
}

function validAction(value: unknown, state: BattleState): value is BattleAction {
  if (!record(value) || !fields(value,
    ['from', 'to', 'kind', 'damage', 'distance', 'falloff', 'support', 'lethal', 'piece', 'color', 'notation', 'ply'],
    ['target', 'targetHp', 'promotion', 'rookFrom', 'rookTo', 'victimSquare'])) return false
  const action = value
  if (!isSquare(action.from) || !isSquare(action.to) || action.from === action.to
    || !isType(action.piece) || !isColor(action.color) || action.color !== other(state.turn)
    || !integer(action.ply, 1) || action.ply !== state.ply || !integer(action.damage)
    || !integer(action.distance, 1) || action.distance !== distanceBetween(action.from, action.to)
    || !integer(action.falloff) || !integer(action.support) || action.support > 15 || typeof action.lethal !== 'boolean'
    || typeof action.notation !== 'string' || !action.notation.length || action.notation.length > 128) return false
  const dx = Math.abs(FILES.indexOf(action.from[0]) - FILES.indexOf(action.to[0]))
  const dy = Number(action.to[1]) - Number(action.from[1])
  const forward = action.color === 'w' ? 1 : -1
  const castle = castleSquares(action.color, action.to[0] === 'g')
  const hasCastle = Object.hasOwn(action, 'rookFrom') || Object.hasOwn(action, 'rookTo')
  if (hasCastle && (action.kind !== 'move' || action.piece !== 'k' || action.from !== castle.from
    || action.to !== castle.to || action.rookFrom !== castle.rookFrom || action.rookTo !== castle.rookTo
    || state.board[castle.rookFrom] || state.board[castle.rookTo]?.type !== 'r'
    || state.board[castle.rookTo]?.color !== action.color || !state.board[castle.rookTo]?.moved)) return false
  if (action.piece === 'p') {
    if (action.kind === 'move') {
      if (dx !== 0 || (dy !== forward && (dy !== forward * 2 || action.from[1] !== (action.color === 'w' ? '2' : '7')))) return false
    } else if (dx < 1 || dx > UNIT_STATS.p.range || dy !== forward * dx) return false
  } else if (action.piece === 'n') {
    if (!((dx === 1 && Math.abs(dy) === 2) || (dx === 2 && Math.abs(dy) === 1))) return false
  } else if (action.piece === 'k') {
    if (!hasCastle && action.distance !== 1) return false
  } else if (action.piece === 'b' ? dx !== Math.abs(dy)
    : action.piece === 'r' ? dx !== 0 && dy !== 0 : dx !== 0 && dy !== 0 && dx !== Math.abs(dy)) return false
  const hasVictim = Object.hasOwn(action, 'victimSquare')
  if (hasVictim && (action.kind !== 'attack' || action.piece !== 'p' || action.target !== 'p'
    || action.distance !== 1 || action.from[1] !== (action.color === 'w' ? '5' : '4')
    || action.victimSquare !== `${action.to[0]}${action.from[1]}`)) return false
  if (action.kind === 'attack') {
    if (!isType(action.target) || !integer(action.targetHp, 1) || action.targetHp > UNIT_STATS[action.target].health
      || action.distance > UNIT_STATS[action.piece].range
      || action.damage !== Math.min(action.targetHp, damageAt(action.piece, action.distance, action.support).damage)
      || action.falloff !== damageAt(action.piece, action.distance).falloff
      || action.lethal !== (action.damage === action.targetHp)) return false
    if (!action.lethal) {
      const victim = state.board[(action.victimSquare ?? action.to) as Square]
      if (victim?.type !== action.target || victim.color !== other(action.color)
        || victim.hp !== action.targetHp - action.damage || (hasVictim && state.board[action.to])) return false
    } else if (hasVictim && state.board[action.victimSquare as Square]) return false
  } else if (action.kind !== 'move' || action.damage !== 0 || action.falloff !== 0 || action.support !== 0 || action.lethal
    || Object.hasOwn(action, 'target') || Object.hasOwn(action, 'targetHp') || hasVictim) return false
  const relocated = action.kind === 'move' || action.lethal
  const promotes = action.piece === 'p' && action.to[1] === (action.color === 'w' ? '8' : '1') && relocated
  if (promotes ? !PROMOTIONS.includes(action.promotion as PieceSymbol) : Object.hasOwn(action, 'promotion')) return false
  const attacker = state.board[relocated ? action.to : action.from]
  return attacker?.color === action.color && attacker.type === (promotes ? action.promotion : action.piece)
    && (!relocated || (attacker.moved && !state.board[action.from]))
}

export function validateBattle(value: unknown): value is BattleState {
  try {
    if (!record(value) || !fields(value, ['board', 'turn', 'ply', 'winner', 'lastAction', 'enPassant', 'quietTurns'])
      || !record(value.board) || !isColor(value.turn) || !integer(value.ply) || !integer(value.quietTurns)
      || value.ply % 2 !== (value.turn === 'w' ? 0 : 1)
      || (value.winner !== null && !isColor(value.winner))
      || (value.enPassant !== null && !isSquare(value.enPassant))) return false
    const kings = { w: 0, b: 0 }
    const ids = new Set<string>()
    for (const [square, piece] of Object.entries(value.board)) {
      if (!isSquare(square) || !record(piece) || !fields(piece, ['id', 'type', 'color', 'hp', 'moved'])
        || typeof piece.id !== 'string' || !piece.id.length || piece.id.length > 128 || ids.has(piece.id)
        || !isType(piece.type) || !isColor(piece.color) || !integer(piece.hp, 1)
        || piece.hp > UNIT_STATS[piece.type].health || typeof piece.moved !== 'boolean'
        || (piece.type === 'p' && (square[1] === '1' || square[1] === '8'))) return false
      ids.add(piece.id)
      if (piece.type === 'k') kings[piece.color] += 1
    }
    if (value.winner === null ? kings.w !== 1 || kings.b !== 1
      : kings[value.winner] !== 1 || kings[other(value.winner)] !== 0) return false
    const state = value as unknown as BattleState
    if (state.lastAction !== null && !validAction(state.lastAction, state)) return false
    if (state.enPassant !== null) {
      const rank = state.turn === 'w' ? '6' : '3'
      const victimSquare = `${state.enPassant[0]}${state.turn === 'w' ? '5' : '4'}` as Square
      const sourceSquare = `${state.enPassant[0]}${state.turn === 'w' ? '7' : '2'}` as Square
      const victim = state.board[victimSquare]
      if (state.enPassant[1] !== rank || state.board[state.enPassant] || state.board[sourceSquare]
        || victim?.type !== 'p' || victim.color !== other(state.turn) || !victim.moved || state.quietTurns !== 0
        || (state.lastAction !== null && (state.lastAction.kind !== 'move' || state.lastAction.piece !== 'p'
          || state.lastAction.from !== sourceSquare || state.lastAction.to !== victimSquare))) return false
    }
    if (state.lastAction !== null) {
      const action = state.lastAction
      if ((action.kind === 'attack' || action.piece === 'p') ? state.quietTurns !== 0 : state.quietTurns < 1) return false
      if ((action.lethal && action.target === 'k') ? state.winner !== action.color : state.winner !== null) return false
      const doublePush = action.kind === 'move' && action.piece === 'p' && action.distance === 2
      if (doublePush !== (state.enPassant !== null)) return false
    }
    return true
  } catch {
    return false
  }
}

export function battleOutcome(state: BattleState): string | null {
  if (state.winner) return state.winner === 'w' ? 'White wins' : 'Black wins'
  if (state.quietTurns >= 100) return 'Draw: no progress (100 quiet turns)'
  if (!battleActions(state).length) return 'Draw: stalemate (no legal actions)'
  return null
}
