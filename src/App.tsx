import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Chess } from 'chess.js'
import type { Color, PieceSymbol, Square } from 'chess.js'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen,
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clock3, Copy, Flag, History, Lightbulb, Menu,
  Plus, RotateCcw, Settings2, Share2, ShieldCheck, Sparkles,
  Swords, Users, Volume2, VolumeX, X,
} from 'lucide-react'
import { ChessPiece } from './ChessPiece'
import type { EngineResponse } from './engine.worker'
import type { ComputerMove } from './engine'
import { acceptAnswer, createAnswer, createOffer, extractCode, inviteLink } from './pvp'
import type { FriendLink, LinkPhase, PlayMode, PvpLink, PvpMessage } from './pvp'
import { RelayLink, formatRoomCode, makeRoomCode, normalizeRoomCode, playLink } from './relay'

const LEVELS = [
  { name: 'Beginner', caption: 'A friendly place to start.', rating: '600' },
  { name: 'Casual', caption: 'Find your rhythm.', rating: '1000' },
  { name: 'Intermediate', caption: 'A balanced challenge.', rating: '1400' },
  { name: 'Advanced', caption: 'Make every move count.', rating: '1800' },
]
const NAMES: Record<PieceSymbol, string> = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }
const START_TIME = 600
const SAVE_KEY = 'chess-club-game-v1'
const ARCHIVE_KEY = 'chess-club-archive-v1'
type EndReason = 'resigned' | 'timeout-w' | 'timeout-b' | null
type ModalType = 'new' | 'resign' | 'result' | 'learn' | 'archive' | 'preferences' | 'join' | 'link' | null
type Settings = { sound: boolean; hints: boolean; coordinates: boolean; theme: 'sage' | 'walnut' | 'slate' }
type SavedGame = { pgn: string; playerColor: Color; level: number; seconds: Record<Color, number>; timed: boolean; endReason: EndReason; id: string; settings: Settings; mode?: PlayMode; resignColor?: Color | null }
type ArchivedGame = { id: string; pgn: string; title: string; date: string; moves: number; color: Color; level: number; mode?: PlayMode }
type PendingGame = { mode: PlayMode; color: Color; level: number; timed: boolean; id: string }
const DEFAULT_SETTINGS: Settings = { sound: true, hints: true, coordinates: true, theme: 'sage' }

function readSavedGame(): Partial<SavedGame> {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') as Partial<SavedGame>
    if (data.pgn) new Chess().loadPgn(data.pgn)
    return data
  } catch { return {} }
}

function readArchive(): ArchivedGame[] {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]') as ArchivedGame[] } catch { return [] }
}

function playMoveSound(capture = false) {
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(capture ? 290 : 440, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(140, context.currentTime + 0.075)
    gain.gain.setValueAtTime(0.08, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.1)
    oscillator.onended = () => { void context.close() }
  } catch { return }
}

function formatTime(value: number) {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function IconButton({ children, label, onClick, disabled = false, className = '' }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function App() {
  const [initial] = useState(readSavedGame)
  const [game] = useState(() => { const chess = new Chess(); if (initial.pgn) chess.loadPgn(initial.pgn); return chess })
  const [fen, setFen] = useState(game.fen())
  const [gameId, setGameId] = useState(initial.id || crypto.randomUUID())
  const [playerColor, setPlayerColor] = useState<Color>(initial.playerColor || 'w')
  const [level, setLevel] = useState(initial.level || 3)
  const [seconds, setSeconds] = useState<Record<Color, number>>(initial.seconds || { w: START_TIME, b: START_TIME })
  const [timed, setTimed] = useState(initial.timed ?? true)
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...initial.settings })
  const [endReason, setEndReason] = useState<EndReason>(initial.endReason || null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [modal, setModal] = useState<ModalType>(null)
  const [panelTab, setPanelTab] = useState<'game' | 'settings'>('game')
  const [reviewPly, setReviewPly] = useState<number | null>(null)
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null)
  const [newColor, setNewColor] = useState<'w' | 'b' | 'random'>('w')
  const [newLevel, setNewLevel] = useState(level)
  const [newTimed, setNewTimed] = useState(timed)
  const [newMode, setNewMode] = useState<PlayMode>('computer')
  const [mode, setMode] = useState<PlayMode>(initial.mode === 'online' ? 'online' : 'computer')
  const [resignColor, setResignColor] = useState<Color | null>(initial.resignColor || null)
  const [linkPhase, setLinkPhase] = useState<LinkPhase | 'idle'>('idle')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkRole, setLinkRole] = useState<'host' | 'guest' | null>(null)
  const [linkKind, setLinkKind] = useState<'relay' | 'manual' | null>(null)
  const [roomCode, setRoomCode] = useState('')
  const [inviteText, setInviteText] = useState('')
  const [replyText, setReplyText] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [joinInput, setJoinInput] = useState('')
  const [linkError, setLinkError] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [archive, setArchive] = useState(readArchive)
  const historyRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const soundRef = useRef(settings.sound)
  const linkRef = useRef<FriendLink | null>(null)
  const joinRef = useRef<(input: string) => void>(() => {})
  const sessionRef = useRef(0)
  const readyRef = useRef(false)
  const inboxRef = useRef<PvpMessage[]>([])
  const modeRef = useRef(mode)
  const playerRef = useRef(playerColor)
  const secondsRef = useRef(seconds)
  modeRef.current = mode
  playerRef.current = playerColor
  secondsRef.current = seconds
  const history = game.history({ verbose: true })
  const finished = game.isGameOver() || endReason !== null
  const computerColor: Color = playerColor === 'w' ? 'b' : 'w'
  const isComputerTurn = mode === 'computer' && !linkBusy && game.turn() === computerColor && !finished
  const isReversed = (playerColor === 'b') !== flipped
  const isReview = reviewPly !== null
  const activePly = reviewPly ?? history.length
  const displayGame = isReview ? new Chess() : game
  if (isReview) history.slice(0, activePly).forEach(move => displayGame.move(move.san))
  const lastMove = history[activePly - 1]
  const onlineWait = mode === 'online' && linkPhase !== 'open'
  const ourTurn = game.turn() === playerColor
  const movesLocked = finished || isReview || isComputerTurn || !ourTurn || onlineWait || linkBusy
  const possibleMoves = selected && !movesLocked ? game.moves({ square: selected, verbose: true }) : []
  const legalSquares = possibleMoves.map(move => move.to)
  const colorName = playerColor === 'w' ? 'white' : 'black'
  const rows = Array.from({ length: 8 }, (_, index) => isReversed ? index + 1 : 8 - index)
  const files = (isReversed ? 'hgfedcba' : 'abcdefgh').split('')
  const winner: Color | null = endReason === 'resigned'
    ? (resignColor === 'w' ? 'b' : resignColor === 'b' ? 'w' : computerColor)
    : endReason?.startsWith('timeout')
      ? (endReason === 'timeout-w' ? 'b' : 'w')
      : game.isCheckmate()
        ? (game.turn() === 'w' ? 'b' : 'w')
        : null
  const resultTitle = winner
    ? (winner === playerColor ? 'Well played. You win!' : 'A good game. A new lesson.')
    : 'An evenly matched game.'
  const resultDetail = endReason === 'resigned'
    ? (mode === 'computer'
      ? 'You resigned. The computer wins.'
      : resignColor === playerColor ? 'You resigned.' : 'Your friend resigned.')
    : endReason?.startsWith('timeout')
      ? (mode === 'computer'
        ? `${winner === playerColor ? 'The computer' : 'You'} ran out of time.`
        : `${endReason === 'timeout-w' ? 'White' : 'Black'} ran out of time.`)
      : game.isCheckmate()
        ? `Checkmate. ${winner === 'w' ? 'White' : 'Black'} wins.`
        : game.isStalemate()
          ? 'A draw by stalemate.'
          : game.isThreefoldRepetition()
            ? 'A draw by threefold repetition.'
            : game.isInsufficientMaterial()
              ? 'A draw by insufficient material.'
              : 'The game ends in a draw.'
  const statusText = finished
    ? (mode === 'computer'
      ? (winner === playerColor ? 'You win. Well played!' : winner ? 'The computer wins' : 'Draw — well played')
      : winner ? `${winner === 'w' ? 'White' : 'Black'} wins` : 'Draw')
    : onlineWait
      ? (linkPhase === 'idle' ? (history.length ? 'This link ended. Start a new game.' : 'Invite a friend to start.') : 'The link is not open.')
      : isReview
        ? `Move ${Math.ceil(activePly / 2)} · Review`
        : mode === 'computer'
          ? (isComputerTurn ? 'The computer is thinking' : game.isCheck() ? 'You are in check' : 'Your move')
          : game.turn() !== playerColor
            ? 'Your friend has the next move.'
            : game.isCheck()
              ? 'You are in check'
              : 'Your move'
  const opponentLabel = mode === 'computer' ? LEVELS[level - 1].name : 'Online'
  const activeColor: Color = playerColor
  const infoModal = modal === 'archive' || modal === 'learn' || modal === 'preferences'

  useEffect(() => { soundRef.current = settings.sound }, [settings.sound])

  const commitMove = useCallback((move: ComputerMove, remote = false) => {
    try {
      const result = game.move(move)
      if (result) {
        setFen(game.fen())
        setSelected(null)
        setPromotion(null)
        setReviewPly(null)
        if (soundRef.current) playMoveSound(Boolean(result.captured))
        if (!remote && modeRef.current === 'online' && linkRef.current?.phase === 'open') {
          linkRef.current.send({ type: 'move', from: move.from, to: move.to, promotion: move.promotion, fen: game.fen(), pgn: game.pgn(), seconds: secondsRef.current })
        }
      }
    } catch { setSelected(null) }
  }, [game])

  useEffect(() => {
    if (mode !== 'computer' || linkBusy || game.turn() === playerColor || finished) return
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    const started = performance.now()
    let timer: ReturnType<typeof setTimeout>
    const apply = (move: ComputerMove | null) => {
      const fallback = game.moves({ verbose: true })[0]
      const next = move || fallback
      if (next) timer = setTimeout(() => commitMove(next), Math.max(0, 650 - (performance.now() - started)))
    }
    worker.onmessage = ({ data }: MessageEvent<EngineResponse>) => {
      if (data.fen === game.fen()) apply(data.move)
    }
    worker.onerror = () => apply(null)
    worker.postMessage({ fen, level, requestId: fen })
    return () => { worker.terminate(); clearTimeout(timer) }
  }, [fen, level, playerColor, finished, game, commitMove, mode, linkBusy])

  useEffect(() => {
    if (!timed || finished || history.length === 0) return
    const timer = setInterval(() => {
      setSeconds(current => ({ ...current, [game.turn()]: Math.max(0, current[game.turn()] - 1) }))
    }, 1000)
    return () => clearInterval(timer)
  }, [timed, finished, history.length, game])

  useEffect(() => {
    if (timed && !finished && (seconds.w === 0 || seconds.b === 0)) {
      const color: Color = seconds.w === 0 ? 'w' : 'b'
      setEndReason(color === 'w' ? 'timeout-w' : 'timeout-b')
      if (mode === 'online' && linkRef.current?.phase === 'open') linkRef.current.send({ type: 'timeout', color })
    }
  }, [seconds, timed, finished, mode])

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ pgn: game.pgn(), playerColor, level, seconds, timed, endReason, id: gameId, settings, mode, resignColor }))
    } catch { return }
  }, [fen, game, playerColor, level, seconds, timed, endReason, gameId, settings, mode, resignColor])

  useEffect(() => {
    if (!finished) return
    setModal('result')
    const entry: ArchivedGame = { id: gameId, pgn: game.pgn(), title: resultDetail, date: new Date().toISOString(), moves: Math.ceil(game.history().length / 2), color: playerColor, level, mode }
    setArchive(current => {
      const next = [entry, ...current.filter(item => item.id !== gameId)].slice(0, 30)
      try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next)) } catch { return next }
      return next
    })
  }, [finished, gameId, game, resultDetail, playerColor, level, mode])

  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' }) }, [history.length])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer) } }, [toast])

  useEffect(() => {
    const openFromHash = () => {
      const hash = location.hash
      if (hash.startsWith('#play/') && normalizeRoomCode(hash)) joinRef.current(hash)
      else if (hash.startsWith('#join/') && extractCode(hash).startsWith('cc1')) joinRef.current(extractCode(hash))
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => {
      window.removeEventListener('hashchange', openFromHash)
      linkRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (!modal && !promotion) return
    const previousFocus = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => modalRef.current?.querySelector<HTMLElement>('button, select, input')?.focus())
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setModal(null); setPromotion(null) }
      if (event.key === 'Tab') {
        const items = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"]')
        if (!items?.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previousFocus?.focus() }
  }, [modal, promotion])

  function applyRemote(message: PvpMessage) {
    if (message.type === 'move') {
      if (game.turn() === playerRef.current) return
      try {
        const result = game.move({ from: message.from, to: message.to, promotion: message.promotion })
        if (!result) return
        setFen(game.fen())
        setSelected(null)
        setPromotion(null)
        setReviewPly(null)
        if (message.seconds) setSeconds(message.seconds)
        if (soundRef.current) playMoveSound(Boolean(result.captured))
      } catch { return }
      return
    }
    if (message.type === 'resign') {
      setResignColor(message.color)
      setEndReason('resigned')
      return
    }
    if (message.type === 'timeout') setEndReason(message.color === 'w' ? 'timeout-w' : 'timeout-b')
  }

  function takeRemote(message: PvpMessage) {
    if (!readyRef.current) inboxRef.current.push(message)
    else applyRemote(message)
  }

  function closeLink() {
    sessionRef.current += 1
    readyRef.current = false
    inboxRef.current = []
    linkRef.current?.close()
    linkRef.current = null
    setLinkPhase('idle')
    setLinkBusy(false)
    setLinkRole(null)
    setLinkKind(null)
    if (location.hash.startsWith('#play/') || location.hash.startsWith('#join/')) window.history.replaceState(null, '', `${location.pathname}${location.search}`)
  }

  function cancelLink() {
    closeLink()
    setLinkError('')
    setModal(null)
  }

  function resetBoard(next: PendingGame) {
    game.reset()
    setFen(game.fen())
    setGameId(next.id)
    setPlayerColor(next.color)
    setLevel(next.level)
    setMode(next.mode)
    setTimed(next.timed)
    setSeconds({ w: START_TIME, b: START_TIME })
    setEndReason(null)
    setResignColor(null)
    setSelected(null)
    setPromotion(null)
    setReviewPly(null)
    setFlipped(false)
    setModal(null)
    readyRef.current = next.mode === 'online'
    if (next.mode === 'online') {
      const queued = inboxRef.current.splice(0)
      queued.forEach(applyRemote)
      window.history.replaceState(null, '', `${location.pathname}${location.search}`)
    }
  }

  function attachLink(next: FriendLink, pending: () => PendingGame) {
    const session = ++sessionRef.current
    readyRef.current = false
    inboxRef.current = []
    linkRef.current?.close()
    linkRef.current = next
    setLinkPhase(next.phase)
    setLinkBusy(true)
    setLinkRole(next.role)
    setLinkKind(next instanceof RelayLink ? 'relay' : 'manual')
    setLinkError('')
    next.onStatus(phase => {
      if (sessionRef.current !== session) return
      setLinkPhase(phase)
      if (phase === 'open') {
        setLinkBusy(false)
        resetBoard(pending())
        setToast('You are connected.')
      }
      if (phase === 'failed') setLinkError(next instanceof RelayLink ? 'The public relays are not reachable. Use a manual code.' : 'This connection failed. Some networks block a direct link.')
      if (phase === 'closed') setToast('Your friend left the game.')
    })
    next.onMessage(message => {
      if (sessionRef.current !== session) return
      takeRemote(message)
    })
  }

  function guestGame(next: FriendLink): PendingGame {
    return { mode: 'online', color: next.hostColor === 'w' ? 'b' : 'w', level, timed: next.timed, id: next.gameId || crypto.randomUUID() }
  }

  function attemptMove(from: Square, to: Square) {
    if (movesLocked) return
    const moves = game.moves({ square: from, verbose: true }).filter(move => move.to === to)
    if (!moves.length) return
    if (moves.some(move => move.promotion)) setPromotion({ from, to })
    else commitMove({ from, to })
  }

  function clickSquare(square: Square) {
    if (movesLocked) return
    if (selected && legalSquares.includes(square)) { attemptMove(selected, square); return }
    const piece = game.get(square)
    const movable = piece?.color === activeColor
    setSelected(movable && square !== selected ? square : null)
  }

  function undoMove() {
    if (!history.length || finished || mode === 'online') return
    game.undo()
    if (mode === 'computer' && game.turn() !== playerColor && game.history().length) game.undo()
    setFen(game.fen())
    setSelected(null)
    setReviewPly(null)
    setPromotion(null)
    setToast('Move taken back. Take another look.')
  }

  function openNewGame(preset: PlayMode = 'computer') {
    setNewColor(playerColor)
    setNewLevel(level)
    setNewTimed(timed)
    setNewMode(preset)
    setLinkError('')
    setMobileMenu(false)
    setModal('new')
  }

  function openJoin() {
    setJoinInput('')
    setLinkError('')
    setMobileMenu(false)
    setModal('join')
  }

  async function startNewGame() {
    if (linkBusy) return
    const color: Color = newColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : newColor
    const id = crypto.randomUUID()
    if (newMode !== 'online') {
      closeLink()
      resetBoard({ mode: newMode, color, level: newLevel, timed: newTimed, id })
      return
    }
    const code = makeRoomCode()
    const next = new RelayLink(code, 'host', { hostColor: color, timed: newTimed, gameId: id })
    attachLink(next, () => ({ mode: 'online', color, level: newLevel, timed: newTimed, id }))
    setRoomCode(code)
    setInviteText(playLink(code))
    setModal('link')
    try {
      await next.start()
    } catch {
      next.fail()
    }
  }

  async function startManual() {
    const current = linkRef.current
    const meta = { hostColor: current?.hostColor || 'w', timed: current?.timed ?? newTimed, gameId: current?.gameId || crypto.randomUUID() }
    closeLink()
    setLinkBusy(true)
    try {
      const next = await createOffer(meta)
      attachLink(next, () => ({ mode: 'online', color: meta.hostColor, level, timed: meta.timed, id: meta.gameId }))
      setInviteText(inviteLink(next.invite))
      setReplyText('')
      setAnswerInput('')
      setModal('link')
    } catch {
      setLinkBusy(false)
      setLinkError('The link could not start. Try again.')
    }
  }

  async function joinCode(input: string) {
    const code = normalizeRoomCode(input)
    if (code) {
      const next = new RelayLink(code, 'guest')
      attachLink(next, () => guestGame(next))
      setRoomCode(code)
      setModal('link')
      try {
        await next.start()
      } catch {
        next.fail()
      }
      return
    }
    if (!extractCode(input).startsWith('cc1')) {
      setLinkError('This code is not valid. Check it and try again.')
      setModal('join')
      return
    }
    setLinkBusy(true)
    try {
      const next = await createAnswer(input)
      attachLink(next, () => guestGame(next))
      setReplyText(next.reply)
      setInviteText('')
      setModal('link')
    } catch (error) {
      setLinkBusy(false)
      setLinkError(error instanceof Error ? error.message : 'This link is not valid.')
      setModal('join')
    }
  }
  joinRef.current = (input: string) => { void joinCode(input) }

  async function connectReply() {
    if (!(linkRef.current && linkKind === 'manual')) return
    setLinkError('')
    try {
      await acceptAnswer(linkRef.current as PvpLink, answerInput)
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'This reply is not valid.')
    }
  }

  async function shareInvite() {
    try {
      await navigator.share({ title: 'Play chess with me', text: `Join my chess game. Code ${formatRoomCode(roomCode)}.`, url: inviteText })
    } catch { return }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setToast('Copied. Send it to your friend.')
    } catch {
      setToast('Select the text and copy it.')
    }
  }

  function confirmResign() {
    const color = playerColor
    setResignColor(color)
    setEndReason('resigned')
    setModal(null)
    if (mode === 'online' && linkRef.current?.phase === 'open') linkRef.current.send({ type: 'resign', color })
  }

  function downloadPgn(pgn = game.pgn(), id = gameId) {
    if (!pgn) { setToast('Make your first move to save this game.'); return }
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `chess-club-${id.slice(0, 8)}.pgn`
    anchor.click()
    URL.revokeObjectURL(url)
    setToast('Your game is saved as a PGN file.')
  }

  function navigateModal(value: ModalType) { setMobileMenu(false); setModal(value) }
  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings(current => ({ ...current, [key]: value })) }
  function reviewMove(ply: number) { setSelected(null); setReviewPly(ply >= history.length ? null : Math.max(0, ply)) }

  function capturedPieces(color: Color) {
    const pieces = history.filter(move => move.color === color && move.captured).map(move => move.captured!)
    return <span className="captured-pieces">{pieces.map((piece, index) => <ChessPiece key={`${piece}-${index}`} color={color === 'w' ? 'b' : 'w'} type={piece} />)}</span>
  }

  function playerBar(computer: boolean) {
    const color = computer ? computerColor : playerColor
    return <div className={`player-bar ${computer ? 'opponent-bar' : 'you-bar'}`}>
      <span className={`player-color color-${color === 'w' ? 'white' : 'black'}`} aria-hidden="true" />
      <div className="player-info"><div className="player-name">{computer ? (mode === 'computer' ? 'The Computer' : 'Friend') : 'You'}</div><div className="player-subtitle">{computer ? (mode === 'computer' ? `${LEVELS[level - 1].name} · Level ${level}` : 'Online') : `Playing as ${colorName}`}{capturedPieces(color)}</div></div>
      <div className={`clock ${!computer && !finished ? 'your-clock' : ''} ${game.turn() === color && history.length > 0 && !finished ? 'clock-active' : ''} ${seconds[color] < 60 && timed ? 'clock-low' : ''}`} aria-label={`${computer ? (mode === 'computer' ? 'Computer' : 'Friend') : 'Your'} time: ${formatTime(seconds[color])}`}><Clock3 size={16} />{timed ? formatTime(seconds[color]) : '∞'}</div>
    </div>
  }

  function settingsContent() {
    return <div className="settings-content">
      {([
        ['hints', 'Legal moves', 'See where each piece can go.'],
        ['coordinates', 'Board coordinates', 'Keep the ranks and files in view.'],
        ['sound', 'Move sounds', 'A little sound with every move.'],
      ] as const).map(([key, title, description]) => <div className="setting-row" key={key}><div><strong>{title}</strong><small>{description}</small></div><button type="button" className={`toggle ${settings[key] ? 'is-on' : ''}`} role="switch" aria-checked={settings[key]} aria-label={title} onClick={() => updateSetting(key, !settings[key])}><span /></button></div>)}
      <div className="theme-setting"><strong>Board color</strong><div className="theme-options">{(['sage', 'walnut', 'slate'] as const).map(theme => <button key={theme} className={`theme-option ${theme} ${settings.theme === theme ? 'chosen' : ''}`} onClick={() => updateSetting('theme', theme)} aria-label={`${theme} board`} aria-pressed={settings.theme === theme}><span className="theme-swatch">{settings.theme === theme && <Check size={16} />}</span><span>{theme}</span></button>)}</div></div>
      <div className="local-note"><ShieldCheck size={16} /><span>Your preferences stay on this device.</span></div>
    </div>
  }

  function modeOptions() {
    return <><label id="opponent-label">Opponent</label><div className="mode-options" role="group" aria-labelledby="opponent-label">
      {([['online', 'Online friend'], ['computer', 'Computer']] as const).map(([value, label]) => <button key={value} type="button" className={newMode === value ? 'chosen' : ''} aria-pressed={newMode === value} onClick={() => setNewMode(value)}>{label}</button>)}
    </div></>
  }

  function newGameFooter() {
    return <>
      <button className="primary-button" onClick={() => { void startNewGame() }}>{newMode === 'online' ? <><Users size={18} />Create invite link</> : <>Let’s play<ArrowRight size={18} /></>}</button>
      {newMode === 'online' && <button className="text-button" onClick={openJoin}>I have a code</button>}
      <div className="modal-footnote">{newMode === 'computer' ? 'White moves first. A good game starts here.' : 'Send one short link. The game starts when your friend opens it.'}</div>
      {linkError && <p className="link-error" role="alert">{linkError}</p>}
    </>
  }

  function joinContent() {
    return <><h2 id="modal-title">Join a friend.</h2><p>Type the code from your friend, or paste the link.</p>
      <form className="link-fields" onSubmit={event => { event.preventDefault(); void joinCode(joinInput) }}>
        <label htmlFor="join-code">Game code</label>
        <input id="join-code" className="code-input" value={joinInput} placeholder="K7QX-M2P4" autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={event => setJoinInput(event.target.value)} />
        {linkError && <p className="link-error" role="alert">{linkError}</p>}
        <button type="submit" className="primary-button" disabled={!joinInput.trim()}>Join game<ArrowRight size={18} /></button>
      </form></>
  }

  function linkContent() {
    const failed = linkPhase === 'failed'
    const footer = <div className="link-footer">
      {linkKind === 'relay' && linkRole === 'host' && <button type="button" className="text-button" onClick={() => { void startManual() }}>Use a manual code instead</button>}
      <button type="button" className="text-button" onClick={cancelLink}>Cancel</button>
    </div>
    if (linkKind === 'relay' && linkRole === 'host') {
      return <><h2 id="modal-title">Invite a friend.</h2><p>Send this link, or tell your friend the code. The game starts when your friend joins.</p>
        <div className="room-code" aria-label="Game code">{formatRoomCode(roomCode)}</div>
        <div className="link-fields"><label htmlFor="invite-link">Invite link</label><input id="invite-link" className="code-input" readOnly value={inviteText} onFocus={event => event.currentTarget.select()} /></div>
        <div className="modal-button-row"><button type="button" className="primary-button" onClick={() => { void copyText(inviteText) }}><Copy size={16} />Copy link</button>{typeof navigator.share === 'function' && <button type="button" className="secondary-button" onClick={() => { void shareInvite() }}><Share2 size={16} />Share</button>}</div>
        {linkError && <p className="link-error" role="alert">{linkError}</p>}
        <p className="friend-note link-status" role="status">{failed ? 'The link could not start.' : <><span className="status-dot" />Waiting for your friend</>}</p>
        {footer}</>
    }
    if (linkKind === 'relay') {
      return <><h2 id="modal-title">Joining your friend.</h2><p>Code {formatRoomCode(roomCode)}. Keep this page open. Your friend must keep the invite open too.</p>
        {linkError && <p className="link-error" role="alert">{linkError}</p>}
        <p className="friend-note link-status" role="status">{failed ? 'The connection could not start.' : <><span className="status-dot" />Connecting</>}</p>
        {failed && <p className="friend-note">Ask your friend for a manual code.</p>}
        {footer}</>
    }
    return <><h2 id="modal-title">{linkRole === 'guest' ? 'Send this reply.' : 'Share this link.'}</h2><p>{linkRole === 'guest' ? 'Send this reply to your friend. A reload ends this link.' : 'Send this link. Then paste the reply. A reload ends this link.'}</p>
      <div className="link-fields">{linkRole === 'guest' ? <><label htmlFor="reply-code">Reply code</label><textarea id="reply-code" readOnly value={replyText} spellCheck={false} /></> : <><label htmlFor="invite-link">Invite link</label><textarea id="invite-link" readOnly value={inviteText} spellCheck={false} /><button type="button" className="secondary-button" onClick={() => { void copyText(inviteText) }}><Copy size={16} />Copy invite link</button><label htmlFor="friend-reply">Friend reply</label><textarea id="friend-reply" value={answerInput} spellCheck={false} onChange={event => setAnswerInput(event.target.value)} /></>}</div>
      {linkError && <p className="link-error" role="alert">{linkError}</p>}
      <p className="friend-note" role="status">{linkPhase === 'connecting' ? 'The link is in progress.' : failed ? 'This connection failed.' : linkRole === 'guest' ? 'Wait for your friend to connect.' : 'Paste the reply, then connect.'}</p>
      {linkRole === 'host' && <button className="primary-button" onClick={() => { void connectReply() }} disabled={!answerInput.trim() || linkPhase === 'connecting'}>Connect<ArrowRight size={18} /></button>}
      {linkRole === 'guest' && <button type="button" className="secondary-button" onClick={() => { void copyText(replyText) }}><Copy size={16} />Copy reply</button>}
      {footer}</>
  }

  return <div className="app-shell">
    <header className="app-header">
      <button className="brand" onClick={() => { setModal(null); setMobileMenu(false) }} aria-label="Chess Club home">
        <span className="brand-mark"><ChessPiece type="n" color="w" /></span>
        <span>chess<span className="brand-light">club</span><span className="brand-period">.</span></span>
      </button>
      <button className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileMenu} aria-controls="main-navigation" onClick={() => setMobileMenu(true)}><Menu size={22} /></button>
      {mobileMenu && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
      <nav id="main-navigation" className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <IconButton label="Close navigation menu" className="sidebar-close" onClick={() => setMobileMenu(false)}><X size={20} /></IconButton>
        <button className={`nav-item ${!infoModal && mode !== 'computer' ? 'nav-active' : ''}`} onClick={() => openNewGame('online')}><Users size={18} /><span>Play a friend</span></button>
        <button className={`nav-item ${!infoModal && mode === 'computer' ? 'nav-active' : ''}`} onClick={() => openNewGame('computer')}><Swords size={18} /><span>Play computer</span></button>
        <button className={`nav-item ${modal === 'archive' ? 'nav-active' : ''}`} onClick={() => navigateModal('archive')}><History size={18} /><span>My games</span>{archive.length > 0 && <span className="nav-count">{archive.length}</span>}</button>
        <button className={`nav-item ${modal === 'learn' ? 'nav-active' : ''}`} onClick={() => navigateModal('learn')}><BookOpen size={18} /><span>How to play</span></button>
        <button className={`nav-item ${modal === 'preferences' ? 'nav-active' : ''}`} onClick={() => navigateModal('preferences')}><Settings2 size={18} /><span>Preferences</span></button>
      </nav>
    </header>

    <main className="main-content" aria-label="Play against the computer">

      <div className="game-layout">
        <section className="board-section" aria-label="Chess game">
          {playerBar(true)}
          <div className={`board-frame theme-${settings.theme} ${!settings.coordinates ? 'no-coordinates' : ''}`}>
            <div className="rank-labels" aria-hidden="true">{rows.map(rank => <span key={rank}>{rank}</span>)}</div>
            <div className="chessboard" role="group" aria-label={`Chess board. ${game.turn() === 'w' ? 'White' : 'Black'} to move`}>
              {rows.flatMap(rank => files.map(file => {
                const square = `${file}${rank}` as Square
                const piece = displayGame.get(square)
                const dark = (file.charCodeAt(0) - 97 + rank) % 2 === 1
                const isLegal = legalSquares.includes(square) && settings.hints
                const isLast = lastMove?.from === square || lastMove?.to === square
                const isCheck = piece?.type === 'k' && piece.color === displayGame.turn() && displayGame.isCheck()
                return <button key={square} type="button" data-square={square} className={`square ${dark ? 'dark' : 'light'} ${selected === square ? 'selected' : ''} ${isLast ? 'last-move' : ''} ${isCheck ? 'in-check' : ''} ${isLegal && piece ? 'can-capture' : ''}`} aria-label={`${square}${piece ? `, ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type].toLowerCase()}` : ', empty'}${isLegal ? ', legal move' : ''}`} aria-pressed={selected === square} onClick={() => clickSquare(square)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = event.dataTransfer.getData('text/plain'); if (/^[a-h][1-8]$/.test(from)) attemptMove(from as Square, square) }}>
                  {piece && <span className="piece-container" draggable={piece.color === activeColor && !movesLocked} onDragStart={event => { if (piece.color !== activeColor || movesLocked) { event.preventDefault(); return } setSelected(square); event.dataTransfer.setData('text/plain', square); event.dataTransfer.effectAllowed = 'move' }}><ChessPiece type={piece.type} color={piece.color} /></span>}
                  {isLegal && !piece && <span className="legal-dot" />}
                </button>
              }))}
            </div>
            <div className="file-labels" aria-hidden="true">{files.map(file => <span key={file}>{file}</span>)}</div>
          </div>
          {playerBar(false)}
          <div className="board-toolbar"><div className={`turn-status ${isComputerTurn ? 'thinking' : ''} ${finished ? 'finished-status' : ''}`} aria-live="polite"><span className="status-dot" />{statusText}{isComputerTurn && <span className="thinking-dots"><i /><i /><i /></span>}</div><div className="board-tools"><IconButton label="Flip board" onClick={() => setFlipped(value => !value)}><RotateCcw size={17} className="flip-icon" /></IconButton><IconButton label={settings.sound ? 'Mute sound' : 'Enable sound'} onClick={() => updateSetting('sound', !settings.sound)}>{settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</IconButton><span className="tool-divider" /><IconButton label="Board preferences" onClick={() => setModal('preferences')}><Settings2 size={18} /></IconButton></div></div>
          {isReview && <div className="board-help"><button onClick={() => setReviewPly(null)}><ArrowLeft size={15} />Back to the live game</button></div>}
          {!isReview && linkPhase !== 'idle' && linkPhase !== 'open' && linkPhase !== 'closed' && modal !== 'link' && <div className="board-help"><button onClick={() => setModal('link')}>{linkRole === 'host' ? 'Show the invite' : 'Show the connection'}</button></div>}
        </section>

        <aside className="game-sidebar" aria-label="Game controls">
          <div className="game-panel">
            <div className="panel-tabs" role="tablist" aria-label="Game panel">
              <button role="tab" aria-selected={panelTab === 'game'} className={panelTab === 'game' ? 'tab-active' : ''} onClick={() => setPanelTab('game')}>Game</button>
              <button role="tab" aria-selected={panelTab === 'settings'} className={panelTab === 'settings' ? 'tab-active' : ''} onClick={() => setPanelTab('settings')}>Settings</button>
            </div>
            <div className="game-actions">
              <div className="friend-actions">
                <button className="primary-button" onClick={() => openNewGame('online')}><Users size={18} />Play a friend</button>
                <button className="secondary-button" onClick={openJoin}>Join</button>
              </div>
              <div className="secondary-actions">
                <button onClick={() => openNewGame(mode)}><Plus size={16} />New game</button>
                <button onClick={undoMove} disabled={!history.length || finished || mode === 'online'}><RotateCcw size={16} />Take back</button>
                <button onClick={() => setModal('resign')} disabled={finished || !history.length}><Flag size={16} />Resign</button>
              </div>
            </div>
            {panelTab === 'game' ? <>
              {mode === 'computer' ? <div className="opponent-settings">
                <div className="difficulty-label"><label htmlFor="difficulty">Difficulty</label><span>Level {level} of 4</span></div>
                <div className="difficulty-select">
                  <select id="difficulty" aria-label="Computer difficulty" value={level} onChange={event => setLevel(Number(event.target.value))}>{LEVELS.map((item, index) => <option key={item.name} value={index + 1}>{item.name}</option>)}</select>
                  <ChevronDown size={16} />
                </div>
              </div> : <div className="opponent-settings"><p className="friend-note">Moves wait until the link is open.</p></div>}
              <div className="history-section"><div className="history-heading"><span className="section-label">Move history</span><span className="move-count">{history.length === 0 ? 'A fresh start' : `${Math.ceil(history.length / 2)} ${history.length < 3 ? 'move' : 'moves'}`}</span><IconButton label="Download game PGN" onClick={() => downloadPgn()}><ArrowDownToLine size={15} /></IconButton></div><div className={`move-history ${history.length === 0 ? 'empty-history' : ''}`} ref={historyRef}>{history.length === 0 ? <div className="empty-history-content"><p>Your moves will appear here.</p></div> : <><div className="history-column-labels"><span>#</span><span>White</span><span>Black</span></div>{Array.from({ length: Math.ceil(history.length / 2) }, (_, index) => <div className="move-row" key={index}><span className="move-number">{index + 1}.</span>{[index * 2, index * 2 + 1].map(ply => <button key={ply} disabled={!history[ply]} className={activePly === ply + 1 ? 'current-move' : ''} onClick={() => reviewMove(ply + 1)}>{history[ply]?.san || '—'}</button>)}</div>)}</>}</div><div className="history-navigation"><span>{isReview ? 'REVIEW' : 'LIVE GAME'}<i className={isReview ? 'review-dot' : ''} /></span><div><IconButton label="First position" disabled={!history.length || activePly === 0} onClick={() => reviewMove(0)}><ChevronsLeft size={17} /></IconButton><IconButton label="Previous move" disabled={!history.length || activePly === 0} onClick={() => reviewMove(activePly - 1)}><ChevronLeft size={17} /></IconButton><IconButton label="Next move" disabled={!isReview} onClick={() => reviewMove(activePly + 1)}><ChevronRight size={17} /></IconButton><IconButton label="Latest position" disabled={!isReview} onClick={() => setReviewPly(null)}><ChevronsRight size={17} /></IconButton></div></div></div>
            </> : <>{settingsContent()}<div className="settings-back"><button className="secondary-button" onClick={() => setPanelTab('game')}><ArrowLeft size={16} />Back to the game</button></div></>}
          </div>
        </aside>
      </div>
    </main>

    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    {(modal || promotion) && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) { setModal(null); setPromotion(null) } }}><div className={`modal ${modal === 'learn' ? 'learn-modal' : ''} ${modal === 'archive' ? 'archive-modal' : ''}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"><IconButton label="Close dialog" className="modal-close" onClick={() => { setModal(null); setPromotion(null) }}><X size={20} /></IconButton>
      {promotion ? <><h2 id="modal-title">Choose your new piece.</h2><p>Your pawn made it to the other side.</p><div className="promotion-options">{(['q', 'r', 'b', 'n'] as PieceSymbol[]).map(type => <button key={type} onClick={() => commitMove({ ...promotion, promotion: type })} aria-label={`Promote to ${NAMES[type].toLowerCase()}`}><ChessPiece type={type} color={activeColor} /><span>{NAMES[type]}</span></button>)}</div></> : modal === 'new' ? <><h2 id="modal-title">A new game. All possibility.</h2><p>{history.length && !finished ? 'This will replace your current game.' : 'Settle in. The board is yours.'}</p><div className="new-game-settings">{modeOptions()}<label>Play as</label><div className="color-options"><button className={newColor === 'w' ? 'chosen' : ''} onClick={() => setNewColor('w')}><ChessPiece type="k" color="w" /><span>White</span>{newColor === 'w' && <Check size={13} />}</button><button className={newColor === 'b' ? 'chosen' : ''} onClick={() => setNewColor('b')}><ChessPiece type="k" color="b" /><span>Black</span>{newColor === 'b' && <Check size={13} />}</button><button className={newColor === 'random' ? 'chosen' : ''} onClick={() => setNewColor('random')}><Sparkles size={25} /><span>Surprise me</span>{newColor === 'random' && <Check size={13} />}</button></div>{newMode === 'computer' && <><label htmlFor="new-difficulty">Your challenge</label><div className="form-select"><select id="new-difficulty" value={newLevel} onChange={event => setNewLevel(Number(event.target.value))}>{LEVELS.map((item, index) => <option key={item.name} value={index + 1}>{item.name} — Level {index + 1}</option>)}</select><ChevronDown size={16} /></div></>}<label htmlFor="time-control">Time control</label><div className="form-select"><select id="time-control" value={newTimed ? '10' : 'none'} onChange={event => setNewTimed(event.target.value === '10')}><option value="10">10 minutes · A little focus</option><option value="none">No clock · Take your time</option></select><Clock3 size={16} /></div></div>{newGameFooter()}</> : modal === 'join' ? joinContent() : modal === 'link' ? linkContent() : modal === 'resign' ? <><h2 id="modal-title">Call it a good game?</h2>{mode === 'computer' ? <p>If you resign, the computer wins this game.<br />There is always another board, another chance.</p> : <p>If you resign, your friend wins this game.</p>}<div className="modal-button-row"><button className="secondary-button" onClick={() => setModal(null)}>Keep playing</button><button className="primary-button" onClick={confirmResign}>Resign game</button></div></> : modal === 'result' ? <><h2 id="modal-title">{resultTitle}</h2><p>{resultDetail}</p><div className="result-stats"><div><strong>{Math.ceil(history.length / 2)}</strong><span>moves played</span></div><div><strong>{opponentLabel}</strong><span>your opponent</span></div></div><button className="primary-button" onClick={() => openNewGame(mode)}><Plus size={18} />Another game<ArrowRight size={18} /></button><button className="text-button" onClick={() => setModal(null)}>Take a look at the board</button></> : modal === 'preferences' ? <><h2 id="modal-title">The little details.</h2>{settingsContent()}</> : modal === 'learn' ? <><h2 id="modal-title">A simple game. Endless depth.</h2><p>Select a piece, then select a destination. You can also drag pieces.</p><p>Your goal: put the other king in check, with no legal escape. That is checkmate.</p><div className="piece-guide">{([
        ['k', 'The King', 'One square in any direction. Keep your king safe.'],
        ['q', 'The Queen', 'Any distance in a straight line, in any direction.'],
        ['r', 'The Rook', 'Any distance along a rank or file.'],
        ['b', 'The Bishop', 'Any distance on a diagonal.'],
        ['n', 'The Knight', 'Two squares, then one to the side. It can jump over pieces.'],
        ['p', 'The Pawn', 'One square forward, two on its first move. Captures one square diagonally.'],
      ] as [PieceSymbol, string, string][]).map(([type, name, description]) => <div key={type}><span><ChessPiece type={type} color="w" /></span><h3>{name}</h3><p>{description}</p></div>)}</div><div className="special-rules"><details><summary>Three special moves<ChevronDown size={16} /></summary><p><strong>Castling:</strong> Move your king two squares toward a rook to move both pieces. Neither piece can have moved. The king cannot cross an attacked square.</p><p><strong>En passant:</strong> When a pawn advances two squares beside your pawn, you can capture it as if it moved one square. This is only possible on the next move.</p><p><strong>Promotion:</strong> A pawn that reaches the last rank becomes a queen, rook, bishop, or knight.</p></details><details><summary>A good place to start<Lightbulb size={16} /></summary><p>Control the center with your pawns. Develop your knights and bishops. Castle to protect your king. Before every move, look for threats.</p></details></div><button className="primary-button" onClick={() => setModal(null)}>Back to the board<ArrowRight size={17} /></button></> : modal === 'archive' ? <><h2 id="modal-title">Your time at the board.</h2><p>Finished games stay here, on this device.</p>{archive.length ? <div className="archive-list">{archive.map(item => <div className="archive-item" key={item.id}><span className="archive-game-icon"><Swords size={22} /></span><div><strong>{item.title}</strong><span>{new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {item.moves} moves · {item.mode && item.mode !== 'computer' ? 'Friend' : LEVELS[item.level - 1].name}</span></div><IconButton label="Download saved game" onClick={() => downloadPgn(item.pgn, item.id)}><ArrowDownToLine size={18} /></IconButton></div>)}</div> : <div className="archive-empty"><ChessPiece type="n" color="w" /><h3>Your story starts with a game.</h3><p>Finish your first game to add it to your collection.</p></div>}<button className="primary-button" onClick={() => setModal(null)}>Back to your game<ArrowRight size={18} /></button></> : null}
    </div></div>}
  </div>
}

export default App
