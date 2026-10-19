import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Color, PieceSymbol, Square } from 'chess.js'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Copy, Crosshair, Flag, Heart, History, MoveUpRight, Plus, RotateCcw, Settings2, Shield, Swords, Target, Users, Volume2, VolumeX, X } from 'lucide-react'
import { ChessPiece } from './ChessPiece'
import { WeaponFx } from './WeaponFx'
import { SUPPORT_BONUS, UNIT_STATS, applyBattleAction, battleActions, battleOutcome, createBattle, healthTotal, validateBattle } from './battle'
import type { BattleAction, BattlePiece, BattleState } from './battle'
import { acceptAnswer, createAnswer, createOffer, inviteLink } from './pvp'
import type { FriendLink, LinkPhase, PvpLink, PvpMessage } from './pvp'
import { RelayLink, formatRoomCode, makeRoomCode, normalizeRoomCode, playLink } from './relay'

type Mode = 'computer' | 'local' | 'online'
type Settings = { sound: boolean; hints: boolean; theme: 'mono' | 'sage' | 'walnut' | 'slate' }
type Session = { id: string; states: BattleState[]; resigned: Color | null }
type SavedBattle = { version: 2; session: Session; mode: Mode; playerColor: Color; level: number; settings: Settings }
type Animation = { id: number; action: BattleAction; before: BattleState; after: BattleState; stage: 'launch' | 'impact' | 'travel' }
type Modal = 'new' | 'rules' | 'settings' | 'resign' | 'archive' | null
const SAVE_KEY = 'chess-but-real-health-v2'
const ARCHIVE_KEY = 'chess-but-real-health-archive-v2'
const DEFAULT_SETTINGS: Settings = { sound: true, hints: true, theme: 'mono' }
const LEVELS = ['Beginner', 'Casual', 'Intermediate', 'Advanced']
const TYPES: PieceSymbol[] = ['p', 'n', 'b', 'r', 'q', 'k']
const other = (color: Color): Color => color === 'w' ? 'b' : 'w'
const side = (color: Color) => color === 'w' ? 'White' : 'Black'
const newSession = (): Session => ({ id: crypto.randomUUID(), states: [createBattle()], resigned: null })
const latest = (session: Session) => session.states[session.states.length - 1]
const stateKey = (state: BattleState) => JSON.stringify(state)

function validSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const session = value as Session
  return typeof session.id === 'string' && session.id.length > 0 && Array.isArray(session.states)
    && session.states.length > 0 && session.states.length <= 2000 && session.states.every(validateBattle)
    && (session.resigned === null || session.resigned === 'w' || session.resigned === 'b')
}

function readSaved(): SavedBattle | null {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as SavedBattle | null
    if (!data || data.version !== 2 || !validSession(data.session)) return null
    return {
      ...data,
      mode: data.mode === 'online' || data.mode === 'local' ? data.mode : 'computer',
      playerColor: data.playerColor === 'b' ? 'b' : 'w',
      level: Number.isInteger(data.level) && data.level >= 1 && data.level <= 4 ? data.level : 3,
      settings: {
        sound: typeof data.settings?.sound === 'boolean' ? data.settings.sound : true,
        hints: typeof data.settings?.hints === 'boolean' ? data.settings.hints : true,
        theme: ['sage', 'walnut', 'slate'].includes(data.settings?.theme) ? data.settings.theme : 'mono',
      },
    }
  } catch { return null }
}

function readArchive(): Session[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]')
    return Array.isArray(data) ? data.filter(validSession).slice(0, 12) : []
  } catch { return [] }
}

function sound(attack: boolean, lethal: boolean) {
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = attack ? 'triangle' : 'sine'
    oscillator.frequency.setValueAtTime(lethal ? 160 : attack ? 320 : 480, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(90, context.currentTime + 0.15)
    gain.gain.setValueAtTime(0.045, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.19)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.2)
    oscillator.onended = () => { void context.close() }
  } catch { return }
}

function describeAction(action: BattleAction) {
  const name = UNIT_STATS[action.piece].name
  if (action.kind === 'move') return `${name} ${action.from} → ${action.to}${action.rookFrom ? ' · castle' : ''}${action.promotion ? ` · ${UNIT_STATS[action.promotion].name}` : ''}`
  return `${name} ${action.from} → ${action.to} · ${action.lethal ? 'capture' : 'attack'}`
}

function PieceHealth({ piece }: { piece: BattlePiece }) {
  const ratio = piece.hp / UNIT_STATS[piece.type].health
  return <><span className={`piece-health ${ratio <= 0.3 ? 'critical' : ''}`} aria-hidden="true"><span className="piece-health-fill" style={{ width: `${ratio * 100}%` }} /></span><span className="piece-hp" aria-hidden="true">{piece.hp}</span></>
}

function App() {
  const [initial] = useState(readSaved)
  const [session, setSession] = useState<Session>(() => initial?.session ?? newSession())
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'computer')
  const [playerColor, setPlayerColor] = useState<Color>(initial?.playerColor ?? 'w')
  const [level, setLevel] = useState(initial?.level ?? 3)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [selected, setSelected] = useState<Square | null>(null)
  const [hovered, setHovered] = useState<Square | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [newMode, setNewMode] = useState<Mode>('computer')
  const [newColor, setNewColor] = useState<Color>('w')
  const [review, setReview] = useState<number | null>(null)
  const [animation, setAnimation] = useState<Animation | null>(null)
  const [archive, setArchive] = useState(readArchive)
  const [phase, setPhase] = useState<LinkPhase | 'idle'>('idle')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  const [joinInput, setJoinInput] = useState('')
  const [replyInput, setReplyInput] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null)
  const sessionRef = useRef(session)
  const configRef = useRef({ mode, playerColor, settings })
  const animationRef = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const linkRef = useRef<FriendLink | null>(null)
  const inbox = useRef<PvpMessage[]>([])
  const receiveRef = useRef<(message: PvpMessage) => void>(() => {})
  const joinRef = useRef<(input: string) => void>(() => {})
  const initialInvite = useRef(location.hash.startsWith('#play/') ? location.hash.slice(6) : location.hash.startsWith('#join/') ? location.href : '')
  const modalRef = useRef<HTMLElement>(null)
  sessionRef.current = session
  configRef.current = { mode, playerColor, settings }
  const state = latest(session)
  const outcome = useMemo(() => battleOutcome(state), [state])
  const finished = Boolean(outcome || session.resigned)
  const winner = session.resigned ? other(session.resigned) : state.winner
  const reviewing = review !== null
  const display = animation ? animation.stage === 'launch' ? animation.before : animation.after : reviewing ? session.states[review] : state
  const ourTurn = mode === 'local' || state.turn === playerColor
  const connected = mode !== 'online' || phase === 'open'
  const locked = finished || reviewing || Boolean(animation) || !ourTurn || !connected
  const reversed = (playerColor === 'b') !== flipped
  const rows = Array.from({ length: 8 }, (_, i) => reversed ? i + 1 : 8 - i)
  const files = (reversed ? 'hgfedcba' : 'abcdefgh').split('')
  const options = useMemo(() => selected && !locked ? battleActions(state, selected) : [], [selected, locked, state])
  const attacks = options.filter(action => action.kind === 'attack')
  const selectedPiece = selected ? display.board[selected] : undefined
  const actions = session.states.slice(1).map(item => item.lastAction!).filter(Boolean)
  const lastAction = display.lastAction
  const opponentColor = other(playerColor)
  const status = animation
    ? animation.action.kind === 'attack' ? animation.action.lethal ? 'Lethal hit. Capture in progress.' : 'Attack in progress.' : 'Piece on the move.'
    : reviewing ? `Review · turn ${Math.ceil(display.ply / 2) || 1}`
      : finished ? winner ? `${side(winner)} wins.` : 'The battle ends in a draw.'
        : !connected ? phase === 'idle' || phase === 'closed' ? 'Connect a friend to play.' : 'Wait for your friend to connect.'
          : mode === 'computer' && !ourTurn ? 'The computer plans its next action.'
            : mode === 'local' ? `${side(state.turn)} to act.` : ourTurn ? 'Your turn. Move or attack.' : 'Your friend has the next turn.'
  const helper = selectedPiece
    ? `${UNIT_STATS[selectedPiece.type].name} on ${selected} · ${selectedPiece.hp}/${UNIT_STATS[selectedPiece.type].health} HP · ${attacks.length} attack target${attacks.length === 1 ? '' : 's'}`
    : 'Select a piece to see its moves, attack range, and damage.'

  const cancelAnimation = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    animationRef.current = false
    inbox.current = []
    setAnimation(null)
  }, [])

  const execute = useCallback((input: { from: string; to: string; promotion?: string }, remote = false) => {
    const current = sessionRef.current
    const before = latest(current)
    if (current.resigned || animationRef.current || battleOutcome(before)) return false
    const after = applyBattleAction(before, input)
    if (!after?.lastAction) return false
    const action = after.lastAction
    const next = { ...current, states: [...current.states, after] }
    sessionRef.current = next
    animationRef.current = true
    setSession(next)
    setSelected(null)
    setHovered(null)
    setReview(null)
    setPromotion(null)
    const id = Date.now()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const attack = action.kind === 'attack'
    const duration = reduced ? 80 : attack ? action.lethal ? 1000 : 900 : 430
    setAnimation({ id, action, before, after, stage: 'launch' })
    const schedule = (delay: number, fn: () => void) => timers.current.push(setTimeout(fn, delay))
    schedule(reduced ? 10 : attack ? 300 : 25, () => {
      setAnimation(currentAnimation => currentAnimation?.id === id ? { ...currentAnimation, stage: attack ? 'impact' : 'travel' } : currentAnimation)
      if (configRef.current.settings.sound) sound(attack, action.lethal)
    })
    if (attack && action.lethal) schedule(reduced ? 25 : 430, () => setAnimation(currentAnimation => currentAnimation?.id === id ? { ...currentAnimation, stage: 'travel' } : currentAnimation))
    schedule(duration, () => {
      setAnimation(null)
      animationRef.current = false
      const pending = inbox.current.splice(0)
      pending.forEach(message => receiveRef.current(message))
    })
    if (!remote && configRef.current.mode === 'online') linkRef.current?.send({ type: 'battle-action', version: 2, gameId: current.id, ply: before.ply, from: input.from, to: input.to, promotion: input.promotion, before: stateKey(before) })
    return true
  }, [])

  function remember(current: Session) {
    if (current.states.length < 2) return
    setArchive(previous => {
      const next = [current, ...previous.filter(item => item.id !== current.id)].slice(0, 12)
      try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next)) } catch { setNotice('The archive is full. Export this battle to keep a copy.') }
      return next
    })
  }

  function reset(nextMode: Mode, color: Color = 'w', id?: string) {
    remember(sessionRef.current)
    cancelAnimation()
    const next = { ...newSession(), ...(id ? { id } : {}) }
    sessionRef.current = next
    setSession(next)
    setMode(nextMode)
    setPlayerColor(color)
    configRef.current = { ...configRef.current, mode: nextMode, playerColor: color }
    setSelected(null)
    setReview(null)
    setPromotion(null)
    setError('')
    setFlipped(false)
    setModal(null)
  }

  function closeLink() {
    const link = linkRef.current
    linkRef.current = null
    link?.close()
    setPhase('idle')
    setInvite('')
    setCode('')
  }

  receiveRef.current = message => {
    if (message.type === 'battle-start') {
      const link = linkRef.current
      if (!link || link.role !== 'guest' || (link.gameId && message.gameId !== link.gameId) || message.hostColor !== link.hostColor) return
      if (sessionRef.current.id === message.gameId && latest(sessionRef.current).ply > 0) return
      reset('online', other(message.hostColor), message.gameId)
      return
    }
    if (message.type === 'battle-action') {
      const current = sessionRef.current
      if (message.gameId !== current.id || message.ply < latest(current).ply) return
      if (animationRef.current) { inbox.current.push(message); return }
      if (latest(current).turn === configRef.current.playerColor || message.ply !== latest(current).ply || message.before !== stateKey(latest(current))) {
        setError('The battle states do not match. Start a new connection.')
        return
      }
      if (!execute(message, true)) setError('Your friend sent an invalid action.')
    }
    if (message.type === 'battle-resign' && message.gameId === sessionRef.current.id && message.ply === latest(sessionRef.current).ply && message.color === other(configRef.current.playerColor)) {
      setSession(current => ({ ...current, resigned: message.color }))
    }
  }

  function bindLink(link: FriendLink) {
    linkRef.current = link
    setPhase(link.phase)
    link.onMessage(message => { if (linkRef.current === link) receiveRef.current(message) })
    link.onStatus(nextPhase => {
      if (linkRef.current !== link) return
      setPhase(nextPhase)
      if (nextPhase === 'open' && link.role === 'host') {
        link.send({ type: 'battle-start', version: 2, gameId: link.gameId, hostColor: link.hostColor })
      }
      if (nextPhase === 'failed') setError('The connection failed. Try a manual connection or a new invite.')
    })
  }

  async function host(manual = false) {
    closeLink()
    reset('online', newColor)
    const id = sessionRef.current.id
    setPhase('gathering')
    try {
      if (manual) {
        const link = await createOffer({ hostColor: newColor, timed: false, gameId: id })
        if (sessionRef.current.id !== id) { link.close(); return }
        bindLink(link)
        setInvite(inviteLink(link.invite))
      } else {
        const room = makeRoomCode()
        const link = new RelayLink(room, 'host', { hostColor: newColor, timed: false, gameId: id })
        bindLink(link)
        setCode(room)
        setInvite(playLink(room))
        await link.start()
      }
    } catch { setError('The invite could not start. Try again.'); setPhase('failed') }
  }

  async function join(input: string) {
    if (!input.trim()) { setError('Enter the code or link from your friend.'); return }
    const room = normalizeRoomCode(input)
    closeLink()
    reset('online', 'b')
    const joiningId = sessionRef.current.id
    setPhase('gathering')
    try {
      if (room) {
        const link = new RelayLink(room, 'guest')
        bindLink(link)
        setCode(room)
        await link.start()
      } else {
        const link = await createAnswer(input)
        if (sessionRef.current.id !== joiningId) { link.close(); return }
        bindLink(link)
        setInvite(link.reply)
      }
    } catch { setError('This code is not valid. Check it and try again.'); setPhase('failed') }
  }
  joinRef.current = input => { void join(input) }

  useEffect(() => {
    const input = initialInvite.current
    if (input) {
      history.replaceState(null, '', location.pathname + location.search)
      const timer = setTimeout(() => { initialInvite.current = ''; joinRef.current(input) }, 0)
      return () => clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 2, session, mode, playerColor, level, settings } satisfies SavedBattle)) }
    catch { setNotice('The browser could not save this battle. Export it to keep a copy.') }
  }, [session, mode, playerColor, level, settings])

  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    linkRef.current?.close()
  }, [])

  useEffect(() => {
    if (mode !== 'computer' || state.turn === playerColor || finished || animation || reviewing || modal) return
    const id = session.id
    const before = stateKey(state)
    let worker: Worker | null = null
    const timer = setTimeout(() => {
      const fallback = () => {
        if (sessionRef.current.id !== id || stateKey(latest(sessionRef.current)) !== before) return
        const moves = battleActions(state)
        const action = moves.find(item => item.lethal) ?? moves.find(item => item.kind === 'attack') ?? moves[0]
        if (action) execute(action)
      }
      try {
        worker = new Worker(new URL('./battle.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ move: { from: string; to: string; promotion?: string } | null; requestId: number }>) => {
          if (sessionRef.current.id !== id || stateKey(latest(sessionRef.current)) !== before) return
          if (event.data.move) execute(event.data.move)
          else fallback()
        }
        worker.onerror = fallback
        worker.postMessage({ state, level, requestId: state.ply })
      } catch { fallback() }
    }, 380)
    return () => { clearTimeout(timer); worker?.terminate() }
  }, [mode, state, playerColor, finished, animation, reviewing, modal, session.id, level, execute])

  useEffect(() => {
    if (!modal && !promotion) return
    const previous = document.activeElement as HTMLElement | null
    const element = modalRef.current
    const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') ?? [])
    focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setModal(null); setPromotion(null) }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [modal, promotion])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelected(null); setHovered(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function chooseSquare(square: Square) {
    if (locked) return
    const action = options.find(item => item.to === square)
    if (action) {
      if (action.promotion) setPromotion({ from: action.from, to: action.to })
      else execute(action)
      return
    }
    const piece = state.board[square]
    setSelected(piece?.color === state.turn && square !== selected ? square : null)
    setHovered(null)
  }

  function undo() {
    if (animation || reviewing || mode === 'online' || session.states.length <= 1) return
    const states = session.states.slice(0, mode === 'computer' && state.turn === playerColor && session.states.length > 2 ? -2 : -1)
    const next = { ...session, states, resigned: null }
    sessionRef.current = next
    setSession(next)
    setSelected(null)
    setReview(null)
  }

  function resign() {
    const color = mode === 'local' ? state.turn : playerColor
    const next = { ...session, resigned: color }
    sessionRef.current = next
    setSession(next)
    setModal(null)
    if (mode === 'online') linkRef.current?.send({ type: 'battle-resign', version: 2, gameId: session.id, ply: state.ply, color })
  }

  function download() {
    const content = JSON.stringify({ version: 2, session, mode, playerColor, level, settings }, null, 2)
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `chess-royale-${session.id.slice(0, 8)}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(invite); setNotice('The invite is copied.') }
    catch { setNotice('Select the invite text and copy it.') }
  }

  function position(square: Square) {
    return { x: files.indexOf(square[0]) * 100 + 50, y: rows.indexOf(Number(square[1])) * 100 + 50 }
  }

  function renderPlayer(color: Color) {
    const total = healthTotal(display, color).current
    const maximum = healthTotal(session.states[0], color).max
    const yours = color === playerColor
    const active = display.turn === color && !finished && !reviewing
    return <div className={`player-bar ${yours ? 'you' : 'opponent'}`}>
      <span className="player-avatar"><ChessPiece type="k" color={color} /></span>
      <div className="player-info"><strong>{mode === 'local' ? `${side(color)} army` : yours ? 'You' : mode === 'computer' ? 'The Computer' : 'Your friend'}{active && <span className="turn-pill">ON TURN</span>}</strong><small>{mode === 'computer' && !yours ? `${LEVELS[level - 1]} · Level ${level}` : `${side(color)} pieces${mode === 'online' ? ` · ${phase === 'open' ? 'Connected' : 'Not connected'}` : ''}`}</small><div className="army-health"><span style={{ width: `${maximum ? total / maximum * 100 : 0}%` }} /></div></div>
      <div className="player-total"><strong><Heart size={14} />{total.toLocaleString()}</strong><small>ARMY HEALTH</small></div>
    </div>
  }

  const anim = animation?.action
  const moving = animation && (anim?.kind === 'move' || anim?.lethal && animation.stage !== 'launch')
  const movingIds = moving ? [animation.before.board[animation.action.from]?.id, animation.action.rookFrom ? animation.before.board[animation.action.rookFrom]?.id : null] : []
  const sourcePoint = anim ? position(anim.from) : null
  const targetPoint = anim ? position(anim.to) : null
  const targetAction = attacks.find(action => action.to === hovered) ?? attacks[0]
  const modalTitle = promotion ? 'Choose your new piece.' : modal === 'rules' ? 'Every piece has a life.' : modal === 'settings' ? 'Make the board yours.' : modal === 'resign' ? 'End this battle?' : modal === 'archive' ? 'Your recent battles.' : 'A new kind of chess.'

  function movingPiece(from: Square, to: Square, piece: BattlePiece, key: string) {
    const start = position(from)
    const end = position(to)
    const style: CSSProperties = {
      left: `${(start.x - 50) / 8}%`, top: `${(start.y - 50) / 8}%`, width: '12.5%', height: '12.5%',
      transform: animation?.stage === 'travel' ? `translate(${end.x - start.x}%, ${end.y - start.y}%)` : 'translate(0, 0)',
      transition: 'transform 420ms cubic-bezier(.22,.68,.18,1)',
    }
    return <div key={key} className="moving-piece" style={style} aria-hidden="true"><span className="piece-visual"><ChessPiece type={piece.type} color={piece.color} /></span><PieceHealth piece={piece} /></div>
  }

  return <div className="battle-app">
    <header className="site-header"><div className="header-inner"><button className="brand" onClick={() => { setNewMode(mode); setModal('new') }} aria-label="Chess Royale home"><ChessPiece type="n" color="w" /><span>Chess <em>Royale</em></span></button><span className="mode-label">HEALTH CHESS</span><nav className="header-nav" aria-label="Main navigation"><button className="nav-button" aria-label="Play a friend" onClick={() => { setNewMode('online'); setModal('new') }}><Users size={17} /><span className="mobile-label">Play a friend</span></button><button className="nav-button" aria-label="My games" onClick={() => setModal('archive')}><History size={17} /><span className="mobile-label">My games</span></button><button className="nav-button" aria-label="How to play" onClick={() => setModal('rules')}><BookOpen size={17} /><span className="mobile-label">How to play</span></button><button className="nav-button" onClick={() => setModal('settings')} aria-label="Preferences"><Settings2 size={18} /></button></nav></div></header>
    <main className="battle-layout">
      <section className="arena-column" aria-label="Health chess game">
        <div className="arena-heading"><div><span className="eyebrow"><span className="status-light" /> THE BATTLEFIELD</span><h1>Chess. With a pulse.</h1><p>Wear them down. Then take their square.</p></div><span className="round-pill">ROUND <strong>{Math.floor(display.ply / 2) + 1}</strong></span></div>
        {renderPlayer(opponentColor)}
        <div className="board-shell">
          <div className="rank-coordinates" aria-hidden="true">{rows.map(rank => <span key={rank}>{rank}</span>)}</div>
          <div className="battle-board" role="group" aria-label={`Chess board. ${side(display.turn)} to act`}>
            {rows.flatMap(rank => files.map(file => {
              const square = `${file}${rank}` as Square
              const piece = display.board[square]
              const option = options.find(action => action.to === square)
              const attack = option?.kind === 'attack' ? option : undefined
              const isTarget = anim?.to === square && anim.kind === 'attack'
              const impacted = isTarget && animation?.stage !== 'launch'
              const name = piece ? `${side(piece.color).toLowerCase()} ${UNIT_STATS[piece.type].name.toLowerCase()}, ${piece.hp} of ${UNIT_STATS[piece.type].health} health` : 'empty'
              return <button type="button" key={square} data-square={square} className={`battle-square ${(file.charCodeAt(0) - 97 + rank) % 2 === 0 ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${lastAction?.from === square ? 'last-from' : ''} ${lastAction?.to === square ? 'last-to' : ''} ${settings.hints && option?.kind === 'move' ? 'move-option' : ''} ${settings.hints && attack ? attack.lethal ? 'attack-option lethal-option' : 'attack-option' : ''} ${hovered === square ? 'danger-square' : ''} ${impacted ? 'hit-target' : ''} ${anim?.from === square && animation?.stage === 'launch' && anim.kind === 'attack' ? 'attack-source' : ''}`} aria-label={`${square}, ${name}${attack ? `, attack for ${attack.damage} damage${attack.lethal ? ', lethal capture' : ''}` : option ? ', legal move' : ''}`} aria-pressed={selected === square} aria-disabled={locked} title={attack ? `${attack.damage} damage · ${attack.distance} square${attack.distance === 1 ? '' : 's'} · ${attack.falloff}% range reduction${attack.support ? ` · +${attack.support * SUPPORT_BONUS}% support (${attack.support})` : ''}${attack.lethal ? ' · Lethal' : ` · ${Math.max(0, (attack.targetHp ?? 0) - attack.damage)} HP remains`}` : piece ? `${UNIT_STATS[piece.type].name} · ${UNIT_STATS[piece.type].weaponName} · ${piece.hp}/${UNIT_STATS[piece.type].health} HP · ${UNIT_STATS[piece.type].damage} damage` : square} onClick={() => chooseSquare(square)} onMouseEnter={() => { if (attack) setHovered(square) }} onMouseLeave={() => setHovered(null)} onKeyDown={event => {
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowUp' ? -8 : event.key === 'ArrowDown' ? 8 : 0
                if (!step) return
                event.preventDefault()
                const index = rows.indexOf(rank) * 8 + files.indexOf(file)
                const next = Math.max(0, Math.min(63, index + step))
                document.querySelector<HTMLButtonElement>(`[data-square="${files[next % 8]}${rows[Math.floor(next / 8)]}"]`)?.focus()
              }} onDragOver={event => { if (!locked) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (!locked) { const from = event.dataTransfer.getData('text/plain'); const action = battleActions(state).find(item => item.from === from && item.to === square); if (action?.promotion) setPromotion({ from: action.from, to: action.to }); else if (action) execute(action) } }}>
                {piece && !movingIds.includes(piece.id) && !(anim?.lethal && anim.kind === 'attack' && animation?.before.board[anim.victimSquare ?? anim.to]?.id === piece.id) && <><span className="piece-visual" draggable={!locked && piece.color === state.turn} onDragStart={event => { if (locked || piece.color !== state.turn) { event.preventDefault(); return } setSelected(square); event.dataTransfer.setData('text/plain', square) }}><ChessPiece type={piece.type} color={piece.color} /></span><PieceHealth piece={piece} /></>}
                {settings.hints && option?.kind === 'move' && !piece && <span className="move-dot" aria-hidden="true" />}
                {settings.hints && attack && <span className={`damage-preview ${attack.lethal ? 'kill-label' : ''} ${attack.support ? 'supported' : ''}`} aria-hidden="true">{attack.lethal ? 'CAPTURE' : `−${attack.damage}`}{attack.support > 0 && <i className="support-pips">{'▲'.repeat(Math.min(3, attack.support))}</i>}</span>}
                {impacted && anim && <span key={animation!.id} className="damage-float" aria-hidden="true">−{anim.damage}{anim.lethal && <small>CAPTURED</small>}</span>}
              </button>
            }))}
            {animation && anim?.kind === 'attack' && sourcePoint && targetPoint && <svg key={animation.id} className={`attack-layer stage-${animation.stage}`} viewBox="0 0 800 800" aria-hidden="true">
              <WeaponFx weapon={UNIT_STATS[anim.piece].weapon} from={sourcePoint} to={targetPoint} stage={animation.stage} lethal={anim.lethal} support={anim.support} />
            </svg>}
            {animation && anim?.kind === 'attack' && anim.lethal && (() => {
              const victimSquare = anim.victimSquare ?? anim.to
              const victim = animation.before.board[victimSquare]
              if (!victim) return null
              const point = position(victimSquare)
              return <div className="moving-piece" key={`${animation.id}-victim`} aria-hidden="true" style={{ left: `${(point.x - 50) / 8}%`, top: `${(point.y - 50) / 8}%`, width: '12.5%', height: '12.5%', opacity: animation.stage === 'launch' ? 1 : 0, transform: animation.stage === 'launch' ? 'scale(1)' : 'scale(.45)', transition: 'opacity 300ms ease, transform 350ms cubic-bezier(.3,0,.2,1)' }}><span className="piece-visual"><ChessPiece type={victim.type} color={victim.color} /></span><PieceHealth piece={victim} /></div>
            })()}
            {moving && animation.before.board[animation.action.from] && movingPiece(animation.action.from, animation.action.to, animation.before.board[animation.action.from]!, `${animation.id}-piece`)}
            {moving && animation.action.rookFrom && animation.action.rookTo && animation.before.board[animation.action.rookFrom] && movingPiece(animation.action.rookFrom, animation.action.rookTo, animation.before.board[animation.action.rookFrom]!, `${animation.id}-rook`)}
          </div>
          <div className="file-coordinates" aria-hidden="true">{files.map(file => <span key={file}>{file}</span>)}</div>
        </div>
        {renderPlayer(playerColor)}
        <div className="turn-banner" role="status" aria-live="polite"><span className="status-light" /><div><strong>{status}</strong><small>{helper}</small></div><button className="nav-button" aria-label="Flip board" title="Flip board" disabled={Boolean(animation)} onClick={() => setFlipped(value => !value)}><RotateCcw size={18} /></button><button className="nav-button" aria-label={settings.sound ? 'Mute sound' : 'Enable sound'} onClick={() => setSettings(current => ({ ...current, sound: !current.sound }))}>{settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button></div>
        <div className="board-legend"><span><i className="legend-dot health" />Piece health</span><span><i className="legend-dot range" />Attack damage</span><span><i className="legend-dot lethal" />Lethal capture</span><button className="text-button" onClick={() => setModal('rules')}>Read the rules <ArrowRight size={13} /></button></div>
        {lastAction && <div className="combat-summary"><span className="summary-icon">{lastAction.kind === 'attack' ? <Swords size={20} /> : <MoveUpRight size={20} />}</span><div><strong>{describeAction(lastAction)}</strong><p>{lastAction.kind === 'attack' ? lastAction.lethal ? 'Target defeated. The attacker takes its square.' : `Both pieces hold position. ${Math.max(0, (lastAction.targetHp ?? lastAction.damage) - lastAction.damage)} target HP remains.` : 'One action complete. The other army takes its turn.'}</p></div>{lastAction.kind === 'attack' && <span className="summary-damage">−{lastAction.damage}<small>HEALTH</small></span>}</div>}
        {reviewing && <div className="result-banner"><strong>Battle review</strong><p>Health and positions match this turn.</p><button className="primary-button" onClick={() => { setReview(null); setSelected(null) }}>Return to the live battle</button></div>}
        {finished && !reviewing && !animation && <div className="result-banner"><strong>{winner ? `${side(winner)} wins the battle.` : 'The battle is a draw.'}</strong><p>{session.resigned ? `${side(session.resigned)} resigned.` : outcome}</p><button className="primary-button" onClick={() => { setNewMode(mode); setModal('new') }}>Play again</button></div>}
      </section>
      <aside className="battle-sidebar" aria-label="Battle controls">
        <section className="control-panel"><div className="panel-heading"><span><Swords size={16} /> BATTLE CONTROL</span><span>{mode === 'computer' ? 'VS COMPUTER' : mode === 'local' ? 'LOCAL DUEL' : 'ONLINE DUEL'}</span></div><div className="mode-tabs" role="group" aria-label="Opponent">{(['computer', 'local', 'online'] as Mode[]).map(item => <button key={item} className={mode === item ? 'active' : ''} onClick={() => { if (item !== mode) { setNewMode(item); setModal('new') } }}>{item === 'computer' ? 'Computer' : item === 'local' ? 'Local friend' : 'Online'}</button>)}</div>
          {mode === 'computer' && <label className="difficulty-field">Difficulty<select aria-label="Computer difficulty" value={level} onChange={event => setLevel(Number(event.target.value))}>{LEVELS.map((name, index) => <option key={name} value={index + 1}>{name} · Level {index + 1}</option>)}</select></label>}
          <div className="action-buttons"><button className="primary-button" onClick={() => { setNewMode(mode); setModal('new') }}><Plus size={15} />New game</button><button className="secondary-button" onClick={undo} disabled={Boolean(animation) || reviewing || mode === 'online' || session.states.length <= 1 || mode === 'computer' && !ourTurn && !finished}><RotateCcw size={14} />Take back</button><button className="secondary-button" onClick={() => setModal('resign')} disabled={finished || Boolean(animation) || reviewing || !connected}><Flag size={14} />Resign</button></div>
        </section>
        {mode === 'online' && <section className="connection-panel"><div className="panel-heading"><span><Users size={16} /> FRIEND CONNECTION</span></div><p className="connection-state">{phase === 'open' ? 'Connected. Health and attacks stay in sync.' : phase === 'idle' ? 'Create an invite or enter a friend’s code.' : phase === 'failed' || phase === 'closed' ? 'The connection is not active.' : 'Wait for your friend. Keep this page open.'}</p>{code && <strong className="invite-code">{formatRoomCode(code)}</strong>}{invite && <><label className="difficulty-field">{linkRef.current?.role === 'guest' ? 'Send this reply to the host' : 'Share this invite'}<input aria-label="Invite link" readOnly value={invite} onFocus={event => event.target.select()} /></label><button className="secondary-button" onClick={() => { void copyInvite() }}><Copy size={14} />Copy</button></>}{phase !== 'open' && <><div className="invite-actions"><button className="primary-button" onClick={() => { void host() }}>Create invite</button><button className="secondary-button" onClick={() => { void host(true) }}>Manual invite</button></div><form onSubmit={event => { event.preventDefault(); void join(joinInput) }}><label className="difficulty-field">Join a friend<input className="code-input" aria-label="Friend code or link" placeholder="Paste a code or link" value={joinInput} onChange={event => setJoinInput(event.target.value)} /></label><button className="secondary-button" type="submit">Join game</button></form>{linkRef.current?.role === 'host' && !code && invite && <form onSubmit={event => { event.preventDefault(); void acceptAnswer(linkRef.current as PvpLink, replyInput).catch(() => setError('This reply is not valid.')) }}><label className="difficulty-field">Friend’s reply<input aria-label="Friend reply" value={replyInput} onChange={event => setReplyInput(event.target.value)} /></label><button type="submit" className="secondary-button">Connect</button></form>}</>}{error && <p role="alert" className="error-message">{error}</p>}</section>}
        <section className="inspector-panel"><div className="panel-heading"><span><Crosshair size={16} /> PIECE INTEL</span><span>{selected ?? 'SELECT A PIECE'}</span></div>{selectedPiece ? <><div className="selected-unit"><span className="unit-portrait"><ChessPiece type={selectedPiece.type} color={selectedPiece.color} /></span><div><span className="eyebrow">{side(selectedPiece.color)} · {selected}</span><h2>{UNIT_STATS[selectedPiece.type].name}</h2><small>{selectedPiece.hp <= UNIT_STATS[selectedPiece.type].health * 0.3 ? 'Critical health. Protect this piece.' : selectedPiece.hp < UNIT_STATS[selectedPiece.type].health ? 'Wounded. Damage stays between turns.' : 'At full health.'}</small></div></div><div className="unit-hp-label"><span><Heart size={13} /> HEALTH</span><strong>{selectedPiece.hp}<small> / {UNIT_STATS[selectedPiece.type].health}</small></strong></div><div className="wide-health"><span style={{ width: `${selectedPiece.hp / UNIT_STATS[selectedPiece.type].health * 100}%` }} /></div><div className="unit-stats"><div><strong>{UNIT_STATS[selectedPiece.type].damage}</strong><small>BASE DAMAGE</small></div><div><strong>{UNIT_STATS[selectedPiece.type].weaponName}</strong><small>WEAPON</small></div><div><strong>+{SUPPORT_BONUS}<small>%</small></strong><small>PER SUPPORTER</small></div></div><p className="inspector-hint">{selectedPiece.type === 'n' ? 'L-shaped lance charges jump over other pieces.' : selectedPiece.type === 'p' ? 'Spear strikes one square diagonally forward, like a chess capture.' : selectedPiece.type === 'k' ? 'Sword strikes any adjacent square.' : 'Attacks follow this piece’s movement lines. Damage drops 15% per extra square. Pieces block the path.'} Each ally that also covers the target adds {SUPPORT_BONUS}% damage.</p><div className="target-list">{attacks.length ? attacks.map(action => <button className={`target-row ${hovered === action.to ? 'is-hovered' : ''}`} key={action.to} disabled={locked} onMouseEnter={() => setHovered(action.to)} onMouseLeave={() => setHovered(null)} onClick={() => chooseSquare(action.to)}><span className="target-square">{action.to}</span><span className="target-copy"><strong>{action.target ? UNIT_STATS[action.target].name : 'Target'}{action.lethal && <span className="target-lethal">LETHAL</span>}</strong><small>{action.distance} sq away · {action.falloff}% reduction{action.support ? ` · +${action.support} support` : ''}</small></span><span className="target-damage">−{action.damage}</span></button>) : <p className="inspector-hint">No targets in range. Move into a better position.</p>}</div>{targetAction && <p className="inspector-hint">{targetAction.lethal ? 'This attack defeats the target and takes its square.' : `This attack leaves ${Math.max(0, (targetAction.targetHp ?? 0) - targetAction.damage)} HP. Neither piece moves.`}</p>}</> : <div className="inspector-empty"><Target size={30} /><strong>Know your next attack.</strong><p>Select one of your pieces to inspect its health, damage, and targets.</p><div className="unit-stats"><div><Heart size={18} /><small>PERSISTENT HP</small></div><div><Crosshair size={18} /><small>RANGE MATTERS</small></div><div><Shield size={18} /><small>NO RANDOM ROLLS</small></div></div></div>}
        </section>
        <section className="log-panel"><div className="panel-heading"><span><History size={16} /> BATTLE LOG</span><button className="nav-button" aria-label="Export battle" title="Export the full battle with health" onClick={download}><ArrowDownToLine size={15} /></button></div>{actions.length ? <ol className="combat-log">{[...actions].reverse().map((action, index) => <li className="log-item" key={action.ply}><span className="log-number">{String(action.ply).padStart(2, '0')}</span><button className="log-copy" onClick={() => { if (!animation) { setReview(session.states.length - 1 - index); setSelected(null) } }}><strong>{describeAction(action)}</strong><small>{side(action.color)} · {action.kind === 'attack' ? `${UNIT_STATS[action.piece].weaponName} · ${action.damage} damage · ${action.distance} sq${action.support ? ` · +${action.support} support` : ''}` : 'Position changed'}</small></button><span className={`log-tag ${action.kind === 'attack' ? action.lethal ? 'kill' : 'attack' : 'move'}`}>{action.kind === 'attack' ? action.lethal ? 'KILL' : 'HIT' : 'MOVE'}</span></li>)}</ol> : <div className="log-empty"><Swords size={24} /><p>The first move starts the story.</p><small>Every attack and capture appears here.</small></div>}<div className="invite-actions"><button className="nav-button" aria-label="First position" disabled={Boolean(animation) || session.states.length < 2} onClick={() => { setReview(0); setSelected(null) }}><ArrowLeft size={15} /></button><button className="nav-button" aria-label="Previous action" disabled={Boolean(animation) || (review ?? session.states.length - 1) <= 0} onClick={() => { setReview(Math.max(0, (review ?? session.states.length - 1) - 1)); setSelected(null) }}><ChevronLeft size={16} /></button><span className="eyebrow">{reviewing ? 'REVIEW' : 'LIVE BATTLE'}</span><button className="nav-button" aria-label="Next action" disabled={Boolean(animation) || !reviewing} onClick={() => setReview(current => current !== null && current < session.states.length - 2 ? current + 1 : null)}><ChevronRight size={16} /></button><button className="nav-button" aria-label="Latest position" disabled={Boolean(animation) || !reviewing} onClick={() => setReview(null)}><ArrowRight size={15} /></button></div></section>
      </aside>
    </main>
    <footer className="battle-footer"><span className="footer-note"><Heart size={13} /> No cards. No dice. Every hit counts.</span><button className="text-button" onClick={() => setModal('rules')}>How health chess works <ArrowRight size={14} /></button></footer>
    {notice && <div className="result-banner" role="status"><p>{notice}</p><button className="text-button" onClick={() => setNotice('')}>Dismiss</button></div>}
    {(modal || promotion) && <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) { setModal(null); setPromotion(null) } }}><section className="battle-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={modalRef}><button className="modal-close nav-button" aria-label="Close dialog" onClick={() => { setModal(null); setPromotion(null) }}><X size={21} /></button><span className="eyebrow">CHESS ROYALE · HEALTH EDITION</span><h2 id="modal-title">{modalTitle}</h2>
      {promotion ? <><p>Promotion keeps the same percentage of health.</p><div className="rule-grid">{(['q', 'r', 'b', 'n'] as PieceSymbol[]).map(type => <button className="rule-unit" key={type} aria-label={`Promote to ${UNIT_STATS[type].name.toLowerCase()}`} onClick={() => execute({ ...promotion, promotion: type })}><span className="rule-piece"><ChessPiece type={type} color={state.turn} /></span><strong>{UNIT_STATS[type].name}</strong></button>)}</div></> : modal === 'rules' ? <>
        <p>Each piece has health and attack damage. Each turn permits one move or one attack.</p><div className="rule-callout"><Swords size={22} /><p><strong>Damage first. Capture last.</strong> A nonlethal attack leaves both pieces in place. At zero health, the target dies and the attacker takes its square.</p></div>
        <div className="rule-grid">{TYPES.map(type => <div className="rule-unit" key={type}><span className="rule-piece"><ChessPiece type={type} color="w" /></span><div><strong>{UNIT_STATS[type].name}</strong><div className="rule-stats"><span><Heart size={12} />{UNIT_STATS[type].health} HP</span><span><Swords size={12} />{UNIT_STATS[type].damage} DMG</span><span><Crosshair size={12} />{UNIT_STATS[type].weaponName}</span></div></div></div>)}</div>
        <h3>Attacks follow chess captures.</h3><p>A piece can attack any square it could capture in normal chess. Pawns strike one square diagonally forward. Knights jump. Kings strike adjacent squares.</p><p>Rooks, bishops, and queens attack along their full lines. Any piece in the path blocks the attack.</p><h3>Distance changes the damage.</h3><p>Count the larger horizontal or vertical distance. Each square after the first reduces base damage by 15 percentage points.</p><p>Damage never falls below 35% of base damage. A rook deals 70 damage at one square, 60 at two, and 28 at five.</p><h3>Support makes attacks stronger.</h3><p>Each ally that could also attack the target adds {SUPPORT_BONUS}% of base damage. Two supporters add {SUPPORT_BONUS * 2}%, three add {SUPPORT_BONUS * 3}%, and so on.</p><p>Supporters must have a clear line to the target. The preview shows the final damage and the number of supporters.</p><h3>Every piece has a weapon.</h3><div className="rule-grid">{TYPES.map(type => <div className="rule-unit" key={type}><span className="rule-piece"><ChessPiece type={type} color="w" /></span><div><strong>{UNIT_STATS[type].weaponName}</strong><div className="rule-stats"><span>{UNIT_STATS[type].name}</span></div></div></div>)}</div><p>Moves use normal chess patterns. Castling requires an unmoved king, an unmoved rook, and a clear path.</p><p>Promotion preserves the percentage of health. Damage does not heal between turns. There are no random rolls.</p><div className="rule-callout"><Shield size={22} /><p><strong>Defeat the king.</strong> A king has 300 HP. There is no check or checkmate. Reduce the enemy king to zero HP to win.</p></div><p>The battle is a draw after 100 turns without an attack or pawn move, or when the active side has no action.</p>
      </> : modal === 'settings' ? <div className="settings-list"><label className="toggle-row"><span>Move and damage hints</span><input type="checkbox" checked={settings.hints} onChange={event => setSettings(current => ({ ...current, hints: event.target.checked }))} /></label><label className="toggle-row"><span>Attack sounds</span><input type="checkbox" checked={settings.sound} onChange={event => setSettings(current => ({ ...current, sound: event.target.checked }))} /></label><label className="difficulty-field">Board theme<select value={settings.theme} onChange={event => setSettings(current => ({ ...current, theme: event.target.value as Settings['theme'] }))}><option value="mono">Graphite</option><option value="sage">Sage</option><option value="walnut">Walnut</option><option value="slate">Slate</option></select></label><p>The game follows your device’s reduced-motion setting.</p></div> : modal === 'resign' ? <><p>Your opponent wins if you resign.</p><div className="invite-actions"><button className="danger-button" onClick={resign}><Flag size={15} />Resign</button><button className="secondary-button" onClick={() => setModal(null)}>Keep playing</button></div></> : modal === 'archive' ? <><p>Recent battles include the exact health of every piece.</p>{archive.length ? archive.map(item => <button className="target-row" key={item.id} onClick={() => { closeLink(); cancelAnimation(); setSession(item); sessionRef.current = item; setMode('local'); setPlayerColor('w'); setReview(item.states.length - 1); setModal(null) }}><span className="target-square"><History size={16} /></span><span className="target-copy"><strong>Battle {item.id.slice(0, 8)}</strong><small>{latest(item).ply} actions · {latest(item).winner ? `${side(latest(item).winner!)} won` : item.resigned ? `${side(other(item.resigned))} won` : 'In progress'}</small></span><ArrowRight size={16} /></button>) : <div className="log-empty"><History size={25} /><p>Your completed and replaced battles appear here.</p></div>}</> : <><p>One action per turn. Persistent health. Every square matters.</p><div className="mode-tabs" role="group" aria-label="New game opponent">{(['computer', 'local', 'online'] as Mode[]).map(item => <button key={item} className={newMode === item ? 'active' : ''} aria-pressed={newMode === item} onClick={() => setNewMode(item)}>{item === 'computer' ? 'Computer' : item === 'local' ? 'Local friend' : 'Online friend'}</button>)}</div><label className="difficulty-field">Your army<select aria-label="Play as" value={newColor} onChange={event => setNewColor(event.target.value as Color)}><option value="w">White · acts first</option><option value="b">Black · acts second</option></select></label>{newMode === 'computer' && <label className="difficulty-field">Your challenge<select aria-label="Your challenge" value={level} onChange={event => setLevel(Number(event.target.value))}>{LEVELS.map((name, index) => <option value={index + 1} key={name}>{name} · Level {index + 1}</option>)}</select></label>}<div className="rule-callout"><Heart size={21} /><p>The target stays on the board until its health reaches zero. Plan several attacks ahead.</p></div><button className="primary-button" onClick={() => { if (newMode === 'online') { void host(); return } closeLink(); reset(newMode, newColor) }}>{newMode === 'online' ? <Users size={16} /> : <Swords size={16} />}{newMode === 'online' ? 'Create invite link' : 'Start battle'}</button>{newMode === 'online' && <form onSubmit={event => { event.preventDefault(); void join(joinInput) }}><label className="difficulty-field">Or join a friend<input aria-label="Friend code or link" value={joinInput} onChange={event => setJoinInput(event.target.value)} placeholder="Paste a code or link" /></label><button className="secondary-button" type="submit">Join game</button></form>}</>}
      {!promotion && modal !== 'new' && <button className="secondary-button" onClick={() => setModal(null)}><Check size={15} />Back to the battle</button>}
    </section></div>}
  </div>
}

export default App
