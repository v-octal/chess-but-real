import type { Color, PieceSymbol, Square } from 'chess.js'
import { UNIT_STATS, applyBattleAction, battleActions, battleOutcome, validateBattle } from './battle'
import type { BattleAction, BattlePiece, BattleState } from './battle'

export { validateBattle } from './battle'

export type BattleComputerMove = { from: string; to: string; promotion?: string }

const VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 6000 }
const LIMITS = [
  { depth: 1, beam: 10, budget: 80, nodes: 300 },
  { depth: 2, beam: 14, budget: 160, nodes: 1200 },
  { depth: 3, beam: 18, budget: 350, nodes: 3500 },
  { depth: 4, beam: 22, budget: 650, nodes: 7000 },
]
const WIN = 1_000_000
const STOP = Symbol('search limit')

type Threats = Map<Square, number[]>
type Search = { deadline: number; nodes: number; maxNodes: number; beam: number }

function other(side: Color): Color {
  return side === 'w' ? 'b' : 'w'
}

function movesFor(state: BattleState, side: Color): BattleAction[] {
  return battleActions(side === state.turn ? state : { ...state, turn: side, enPassant: null })
}

function threats(actions: BattleAction[]): Threats {
  const result: Threats = new Map()
  for (const action of actions) {
    if (action.kind !== 'attack') continue
    const target = action.victimSquare ?? action.to
    const damages = result.get(target) ?? []
    damages.push(action.damage)
    result.set(target, damages)
  }
  for (const damages of result.values()) damages.sort((a, b) => b - a)
  return result
}

function danger(piece: BattlePiece, damages: number[] | undefined): number {
  if (!damages?.length) return 0
  const maximum = damages[0]
  const ratio = Math.min(1, maximum / piece.hp)
  const healthLoss = Math.min(piece.hp, maximum) / UNIT_STATS[piece.type].health
  const currentValue = VALUE[piece.type] * (0.55 + piece.hp / UNIT_STATS[piece.type].health * 0.45)
  const pressure = VALUE[piece.type] * healthLoss * 0.35 + currentValue * ratio * ratio * 0.08
  const lethal = maximum >= piece.hp ? (piece.type === 'k' ? 60_000 : currentValue * 0.35) : 0
  const support = Math.min(piece.hp, damages[1] ?? 0) / piece.hp * currentValue * 0.03
  return pressure + lethal + support
}

function distance(from: Square, to: Square, type: PieceSymbol): number {
  const x = Math.abs(from.charCodeAt(0) - to.charCodeAt(0))
  const y = Math.abs(Number(from[1]) - Number(to[1]))
  const chebyshev = Math.max(x, y)
  if (type === 'n') return Math.min(Math.abs(x - 2) + Math.abs(y - 1), Math.abs(x - 1) + Math.abs(y - 2)) / 2
  if (type === 'b' && (x + y) % 2) return 12
  if (type === 'p' || type === 'k') return Math.max(0, chebyshev - UNIT_STATS[type].range)
  const aligned = type === 'r' ? !x || !y : type === 'b' ? x === y : !x || !y || x === y
  const offLine = type === 'r' ? Math.min(x, y) : type === 'b' ? Math.abs(x - y) / 2 : Math.min(x, y, Math.abs(x - y))
  return (aligned ? 0 : offLine * 0.8 + 1) + Math.max(0, chebyshev - 1) * 0.35
}

function activity(state: BattleState, at: Square, piece: BattlePiece): number {
  let nearest = 12
  for (const [target, enemy] of Object.entries(state.board)) {
    if (!enemy || enemy.color === piece.color) continue
    const priority = enemy.type === 'k' ? 1.15 : 1 + (1 - enemy.hp / UNIT_STATS[enemy.type].health) * 0.15
    nearest = Math.min(nearest, distance(at, target as Square, piece.type) / priority)
  }
  const center = 7 - Math.abs(at.charCodeAt(0) - 100.5) - Math.abs(Number(at[1]) - 4.5)
  const health = piece.hp / UNIT_STATS[piece.type].health
  const scale = piece.type === 'k' ? 0.25 : 0.4 + health * 0.6
  const advance = piece.type === 'p' ? (piece.color === 'w' ? Number(at[1]) - 2 : 7 - Number(at[1])) * 4 : 0
  return (center * 1.5 - nearest * 6 + advance) * scale
}

function evaluate(state: BattleState, context: Search): number {
  checkTime(context)
  const actions = battleActions(state)
  if (!actions.length) return 0
  const currentThreats = threats(actions)
  const enemyThreats = threats(movesFor(state, other(state.turn)))
  checkTime(context)
  let score = 0
  for (const [position, piece] of Object.entries(state.board)) {
    if (!piece) continue
    const health = piece.hp / UNIT_STATS[piece.type].health
    const material = VALUE[piece.type] * (piece.type === 'k' ? health : 0.55 + health * 0.45)
    const value = material + activity(state, position as Square, piece)
      - danger(piece, (piece.color === state.turn ? enemyThreats : currentThreats).get(position as Square))
    score += piece.color === state.turn ? value : -value
  }
  checkTime(context)
  return score
}

function winningAttack(state: BattleState, action: BattleAction): boolean {
  return action.kind === 'attack' && action.lethal
    && state.board[action.victimSquare ?? action.to]?.type === 'k'
}

function orderActions(state: BattleState, actions: BattleAction[], context: Search): BattleAction[] {
  checkTime(context)
  const enemyThreats = threats(movesFor(state, other(state.turn)))
  const ranked = actions.map((action, index) => {
    const piece = state.board[action.from]!
    const target = state.board[action.victimSquare ?? action.to]
    let score = 0
    if (action.kind === 'attack' && target) {
      score += Math.min(action.damage, target.hp) / UNIT_STATS[target.type].health * VALUE[target.type] * 0.8
      if (action.lethal) score += VALUE[target.type]
      if (winningAttack(state, action)) score += WIN
    }
    if (action.kind === 'move' || action.lethal) {
      score += danger(piece, enemyThreats.get(action.from)) * 0.8
      score += activity(state, action.to, piece) - activity(state, action.from, piece)
    }
    if (action.promotion) score += VALUE[action.promotion] - VALUE.p
    return { action, score, index }
  })
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  checkTime(context)
  return ranked.map(({ action }) => action)
}

function checkTime(context: Search): void {
  if (context.nodes >= context.maxNodes || performance.now() >= context.deadline) throw STOP
}

function negamax(state: BattleState, depth: number, alpha: number, beta: number, ply: number, context: Search): number {
  checkTime(context)
  context.nodes += 1
  if (state.winner) return state.winner === state.turn ? WIN - ply : -WIN + ply
  if (depth === 0) return evaluate(state, context)
  const actions = battleActions(state)
  if (!actions.length) return 0
  if (actions.some((action) => winningAttack(state, action))) return WIN - ply - 1
  const ordered = orderActions(state, actions, context).slice(0, context.beam)
  let best = -Infinity
  for (const action of ordered) {
    checkTime(context)
    const next = applyBattleAction(state, action)
    if (!next) continue
    const score = -negamax(next, depth - 1, -beta, -alpha, ply + 1, context)
    best = Math.max(best, score)
    alpha = Math.max(alpha, score)
    if (alpha >= beta) break
  }
  return best === -Infinity ? 0 : best
}

function replyRisk(state: BattleState): number {
  let risk = 0
  for (const action of battleActions(state)) {
    if (action.kind !== 'attack' || !action.lethal) continue
    const target = state.board[action.victimSquare ?? action.to]
    if (target) risk = Math.max(risk, target.type === 'k' ? WIN / 2 : VALUE[target.type])
  }
  return risk
}

function moveOf(action: BattleAction): BattleComputerMove {
  return action.promotion
    ? { from: action.from, to: action.to, promotion: action.promotion }
    : { from: action.from, to: action.to }
}

export function getBattleComputerMove(state: BattleState, level: number): BattleComputerMove | null {
  try {
    const start = performance.now()
    if (!validateBattle(state) || state.winner !== null || battleOutcome(state) !== null) return null
    const difficulty = Number.isFinite(level) ? Math.min(4, Math.max(1, Math.trunc(level))) : 1
    const limit = LIMITS[difficulty - 1]
    const context: Search = { deadline: start + limit.budget - 8, nodes: 0, maxNodes: limit.nodes, beam: limit.beam }
    const actions = battleActions(state)
    if (!actions.length) return null
    const lethal = actions.find((action) => winningAttack(state, action))
    if (lethal) return moveOf(lethal)
    let best = actions[0]
    let minimumRisk = Infinity
    const children = new Map<BattleAction, { state: BattleState; risk: number }>()
    for (const action of actions) {
      const next = applyBattleAction(state, action)
      if (!next) continue
      const risk = next.winner ? 0 : replyRisk(next)
      children.set(action, { state: next, risk })
      if (risk < minimumRisk) {
        minimumRisk = risk
        best = action
      }
      if (risk === 0 || performance.now() >= context.deadline) break
    }
    try {
      const ranked = orderActions(state, actions, context)
      let ordered = [best, ...ranked.filter((action) => action !== best)].slice(0, limit.beam)
      for (let depth = 1; depth <= limit.depth; depth += 1) {
        let candidate = best
        let score = -Infinity
        const results: { action: BattleAction; score: number; index: number }[] = []
        for (const [index, action] of ordered.entries()) {
          checkTime(context)
          let child = children.get(action)
          if (!child) {
            const next = applyBattleAction(state, action)
            if (!next) continue
            child = { state: next, risk: next.winner ? 0 : replyRisk(next) }
            children.set(action, child)
          }
          const value = -negamax(child.state, depth - 1, -Infinity, -score - child.risk, 1, context) - child.risk
          results.push({ action, score: value, index })
          if (value > score) {
            score = value
            candidate = action
          }
        }
        best = candidate
        if (score >= WIN - 100) break
        results.sort((a, b) => b.score - a.score || a.index - b.index)
        ordered = results.map(({ action }) => action)
      }
    } catch (error) {
      if (error !== STOP) throw error
    }
    return moveOf(best)
  } catch {
    return null
  }
}
