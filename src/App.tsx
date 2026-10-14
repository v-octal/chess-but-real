import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Chess } from 'chess.js'
import type { Color, PieceSymbol, Square } from 'chess.js'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen,
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clock3, Crown, Flag, History, Lightbulb, Menu, Monitor,
  Plus, RotateCcw, Settings2, ShieldCheck, Sparkles,
  Swords, Trophy, UserRound, Volume2, VolumeX, X,
} from 'lucide-react'
import { ChessPiece } from './ChessPiece'
import type { EngineResponse } from './engine.worker'
import type { ComputerMove } from './engine'

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
type ModalType = 'new' | 'resign' | 'result' | 'learn' | 'archive' | 'preferences' | null
type Settings = { sound: boolean; hints: boolean; coordinates: boolean; theme: 'sage' | 'walnut' | 'slate' }
type SavedGame = { pgn: string; playerColor: Color; level: number; seconds: Record<Color, number>; timed: boolean; endReason: EndReason; id: string; settings: Settings }
type ArchivedGame = { id: string; pgn: string; title: string; date: string; moves: number; color: Color; level: number }
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
  const [mobileMenu, setMobileMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [archive, setArchive] = useState(readArchive)
  const historyRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const soundRef = useRef(settings.sound)
  const history = game.history({ verbose: true })
  const finished = game.isGameOver() || endReason !== null
  const computerColor: Color = playerColor === 'w' ? 'b' : 'w'
  const isComputerTurn = game.turn() === computerColor && !finished
  const isReversed = (playerColor === 'b') !== flipped
  const isReview = reviewPly !== null
  const activePly = reviewPly ?? history.length
  const displayGame = isReview ? new Chess() : game
  if (isReview) history.slice(0, activePly).forEach(move => displayGame.move(move.san))
  const lastMove = history[activePly - 1]
  const possibleMoves = selected && !isReview ? game.moves({ square: selected, verbose: true }) : []
  const legalSquares = possibleMoves.map(move => move.to)
  const colorName = playerColor === 'w' ? 'white' : 'black'
  const rows = Array.from({ length: 8 }, (_, index) => isReversed ? index + 1 : 8 - index)
  const files = (isReversed ? 'hgfedcba' : 'abcdefgh').split('')
  const winner = endReason === 'resigned' ? computerColor : endReason?.startsWith('timeout') ? (endReason === 'timeout-w' ? 'b' : 'w') : game.isCheckmate() ? (game.turn() === 'w' ? 'b' : 'w') : null
  const resultTitle = winner ? (winner === playerColor ? 'Well played. You win!' : 'A good game. A new lesson.') : 'An evenly matched game.'
  const resultDetail = endReason === 'resigned' ? 'You resigned. The computer wins.' : endReason?.startsWith('timeout') ? `${winner === playerColor ? 'The computer' : 'You'} ran out of time.` : game.isCheckmate() ? `Checkmate. ${winner === 'w' ? 'White' : 'Black'} wins.` : game.isStalemate() ? 'A draw by stalemate.' : game.isThreefoldRepetition() ? 'A draw by threefold repetition.' : game.isInsufficientMaterial() ? 'A draw by insufficient material.' : 'The game ends in a draw.'
  const statusText = finished ? (winner === playerColor ? 'You win. Well played!' : winner ? 'The computer wins' : 'Draw — well played') : isReview ? `Move ${Math.ceil(activePly / 2)} · Review` : isComputerTurn ? 'The computer is thinking' : game.isCheck() ? 'You are in check' : 'Your move'

  useEffect(() => { soundRef.current = settings.sound }, [settings.sound])

  const commitMove = useCallback((move: ComputerMove) => {
    try {
      const result = game.move(move)
      if (result) {
        setFen(game.fen())
        setSelected(null)
        setPromotion(null)
        setReviewPly(null)
        if (soundRef.current) playMoveSound(Boolean(result.captured))
      }
    } catch { setSelected(null) }
  }, [game])

  useEffect(() => {
    if (game.turn() === playerColor || finished) return
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
  }, [fen, level, playerColor, finished, game, commitMove])

  useEffect(() => {
    if (!timed || finished || history.length === 0) return
    const timer = setInterval(() => {
      setSeconds(current => ({ ...current, [game.turn()]: Math.max(0, current[game.turn()] - 1) }))
    }, 1000)
    return () => clearInterval(timer)
  }, [timed, finished, history.length, game])

  useEffect(() => {
    if (timed && !finished && (seconds.w === 0 || seconds.b === 0)) setEndReason(seconds.w === 0 ? 'timeout-w' : 'timeout-b')
  }, [seconds, timed, finished])

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ pgn: game.pgn(), playerColor, level, seconds, timed, endReason, id: gameId, settings }))
    } catch { return }
  }, [fen, game, playerColor, level, seconds, timed, endReason, gameId, settings])

  useEffect(() => {
    if (!finished) return
    setModal('result')
    const entry: ArchivedGame = { id: gameId, pgn: game.pgn(), title: resultDetail, date: new Date().toISOString(), moves: Math.ceil(game.history().length / 2), color: playerColor, level }
    setArchive(current => {
      const next = [entry, ...current.filter(item => item.id !== gameId)].slice(0, 30)
      try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next)) } catch { return next }
      return next
    })
  }, [finished, gameId, game, resultDetail, playerColor, level])

  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' }) }, [history.length])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer) } }, [toast])

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

  function attemptMove(from: Square, to: Square) {
    if (finished || isComputerTurn || isReview) return
    const moves = game.moves({ square: from, verbose: true }).filter(move => move.to === to)
    if (!moves.length) return
    if (moves.some(move => move.promotion)) setPromotion({ from, to })
    else commitMove({ from, to })
  }

  function clickSquare(square: Square) {
    if (finished || isComputerTurn || isReview) return
    if (selected && legalSquares.includes(square)) { attemptMove(selected, square); return }
    const piece = game.get(square)
    setSelected(piece?.color === playerColor && square !== selected ? square : null)
  }

  function undoMove() {
    if (!history.length || finished) return
    game.undo()
    if (game.turn() !== playerColor && game.history().length) game.undo()
    setFen(game.fen())
    setSelected(null)
    setReviewPly(null)
    setPromotion(null)
    setToast('Move taken back. Take another look.')
  }

  function openNewGame() {
    setNewColor(playerColor)
    setNewLevel(level)
    setNewTimed(timed)
    setModal('new')
  }

  function startNewGame() {
    game.reset()
    setFen(game.fen())
    setGameId(crypto.randomUUID())
    setPlayerColor(newColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : newColor)
    setLevel(newLevel)
    setTimed(newTimed)
    setSeconds({ w: START_TIME, b: START_TIME })
    setEndReason(null)
    setSelected(null)
    setPromotion(null)
    setReviewPly(null)
    setFlipped(false)
    setModal(null)
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
      <div className={`player-avatar ${computer ? 'computer-avatar' : 'human-avatar'}`}>{computer ? <Monitor size={23} strokeWidth={1.6} /> : <UserRound size={23} strokeWidth={1.7} />}</div>
      <div className="player-info"><div className="player-name">{computer ? 'The Computer' : 'You'}{!computer && <span className="you-badge">LET’S PLAY</span>}</div><div className="player-subtitle">{computer ? `${LEVELS[level - 1].name} · Level ${level}` : `Playing as ${colorName}`}{capturedPieces(color)}</div></div>
      <div className={`clock ${!computer && !finished ? 'your-clock' : ''} ${game.turn() === color && history.length > 0 && !finished ? 'clock-active' : ''} ${seconds[color] < 60 && timed ? 'clock-low' : ''}`} aria-label={`${computer ? 'Computer' : 'Your'} time: ${formatTime(seconds[color])}`}><Clock3 size={16} />{timed ? formatTime(seconds[color]) : '∞'}</div>
    </div>
  }

  function settingsContent() {
    return <div className="settings-content">
      <div className="section-label">MAKE YOURSELF AT HOME</div>
      <h3>Your board, your way.</h3>
      <p>A few small things for a better game.</p>
      {([
        ['hints', 'Legal moves', 'See where each piece can go.'],
        ['coordinates', 'Board coordinates', 'Keep the ranks and files in view.'],
        ['sound', 'Move sounds', 'A little sound with every move.'],
      ] as const).map(([key, title, description]) => <div className="setting-row" key={key}><div><strong>{title}</strong><small>{description}</small></div><button type="button" className={`toggle ${settings[key] ? 'is-on' : ''}`} role="switch" aria-checked={settings[key]} aria-label={title} onClick={() => updateSetting(key, !settings[key])}><span /></button></div>)}
      <div className="theme-setting"><strong>Board color</strong><div className="theme-options">{(['sage', 'walnut', 'slate'] as const).map(theme => <button key={theme} className={`theme-option ${theme} ${settings.theme === theme ? 'chosen' : ''}`} onClick={() => updateSetting('theme', theme)} aria-label={`${theme} board`} aria-pressed={settings.theme === theme}><span className="theme-swatch">{settings.theme === theme && <Check size={16} />}</span><span>{theme}</span></button>)}</div></div>
      <div className="local-note"><ShieldCheck size={16} /><span>Your preferences stay on this device.</span></div>
    </div>
  }

  return <div className="app-shell">
    {mobileMenu && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <button className="brand" onClick={() => { setModal(null); setMobileMenu(false) }} aria-label="Chess Club home"><span className="brand-mark"><ChessPiece type="n" color="w" /></span><span>chess<span className="brand-light">club</span><span className="brand-period">.</span></span></button>
      <div className="sidebar-nav"><div className="nav-label">THE CLUB</div><button className={`nav-item ${!modal || ['new', 'resign', 'result'].includes(modal) ? 'nav-active' : ''}`} onClick={() => { setModal(null); setMobileMenu(false) }}><Swords size={19} /><span>Play computer</span><span className="nav-active-dot" /></button><button className={`nav-item ${modal === 'archive' ? 'nav-active' : ''}`} onClick={() => navigateModal('archive')}><History size={19} /><span>My games</span>{archive.length > 0 && <span className="nav-count">{archive.length}</span>}</button><button className={`nav-item ${modal === 'learn' ? 'nav-active' : ''}`} onClick={() => navigateModal('learn')}><BookOpen size={19} /><span>How to play</span><ArrowUpRight size={13} className="nav-arrow" /></button></div>
      <div className="sidebar-bottom"><div className="quiet-card"><div className="quiet-art"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><ChessPiece type="n" color="w" /><Sparkles size={13} className="quiet-spark" /></div><h3>A little less noise.<br />A little more chess.</h3><p>Take a breath.<br />Find your next move.</p><div className="quiet-line" /></div><button className="nav-item preferences-nav" onClick={() => navigateModal('preferences')}><Settings2 size={18} /><span>Preferences</span></button><div className="guest-profile"><div className="guest-avatar">G</div><div><strong>Guest player</strong><span>Make yourself at home</span></div><span className="online-dot" /></div></div>
    </aside>

    <main className="main-content">
      <header className="page-header"><div><div className="eyebrow"><button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><span>PLAY. THINK. ENJOY.</span></div><h1>Make your next move<span>.</span></h1><p>No distractions. No pressure. Just a good game of chess.</p></div><div className="header-badge"><span /><span>YOU, THE BOARD & A LITTLE FOCUS</span></div></header>

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
                  {piece && <span className="piece-container" draggable={piece.color === playerColor && !isComputerTurn && !finished && !isReview} onDragStart={event => { if (piece.color !== playerColor || isComputerTurn || finished || isReview) { event.preventDefault(); return } setSelected(square); event.dataTransfer.setData('text/plain', square); event.dataTransfer.effectAllowed = 'move' }}><ChessPiece type={piece.type} color={piece.color} /></span>}
                  {isLegal && !piece && <span className="legal-dot" />}
                </button>
              }))}
            </div>
            <div className="file-labels" aria-hidden="true">{files.map(file => <span key={file}>{file}</span>)}</div>
          </div>
          {playerBar(false)}
          <div className="board-toolbar"><div className={`turn-status ${isComputerTurn ? 'thinking' : ''} ${finished ? 'finished-status' : ''}`} aria-live="polite"><span className="status-dot" />{statusText}{isComputerTurn && <span className="thinking-dots"><i /><i /><i /></span>}</div><div className="board-tools"><IconButton label="Flip board" onClick={() => setFlipped(value => !value)}><RotateCcw size={17} className="flip-icon" /></IconButton><IconButton label={settings.sound ? 'Mute sound' : 'Enable sound'} onClick={() => updateSetting('sound', !settings.sound)}>{settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</IconButton><span className="tool-divider" /><IconButton label="Board preferences" onClick={() => setModal('preferences')}><Settings2 size={18} /></IconButton></div></div>
          <div className="board-help">{isReview ? <button onClick={() => setReviewPly(null)}><ArrowLeft size={13} /> Back to the live game</button> : <><span className="key-hint">TIP</span> Click a piece, then a highlighted square. Make it your move.</>}</div>
        </section>

        <aside className="game-sidebar" aria-label="Game controls">
          <div className="game-panel"><div className="panel-tabs" role="tablist" aria-label="Game panel"><button role="tab" aria-selected={panelTab === 'game'} className={panelTab === 'game' ? 'tab-active' : ''} onClick={() => setPanelTab('game')}><Swords size={17} />Game</button><button role="tab" aria-selected={panelTab === 'settings'} className={panelTab === 'settings' ? 'tab-active' : ''} onClick={() => setPanelTab('settings')}><Settings2 size={16} />Settings</button><span className="classic-badge">CLASSIC</span></div>
            {panelTab === 'game' ? <>
              <div className="opponent-settings"><div className="section-label">YOUR OPPONENT <span>BUILT FOR A GOOD GAME</span></div><div className="opponent-title"><span className="opponent-emblem"><ChessPiece type="n" color="w" /></span><div><h2>The Computer</h2><p>Always ready for one more.</p></div></div><div className="difficulty-label"><label htmlFor="difficulty">Difficulty</label><span>LEVEL {level} OF 4</span></div><div className="difficulty-select"><span className="level-bars" aria-hidden="true">{[1, 2, 3, 4].map(item => <i key={item} className={item <= level ? 'bar-on' : ''} style={{ height: 5 + item * 3 }} />)}</span><select id="difficulty" aria-label="Computer difficulty" value={level} onChange={event => setLevel(Number(event.target.value))}>{LEVELS.map((item, index) => <option key={item.name} value={index + 1}>{item.name}</option>)}</select><ChevronDown size={15} /></div><p className="difficulty-caption">{LEVELS[level - 1].caption}</p></div>
              <div className="history-section"><div className="history-heading"><span className="section-label">MOVE HISTORY</span><span className="move-count">{history.length === 0 ? 'A fresh start' : `${Math.ceil(history.length / 2)} ${history.length < 3 ? 'move' : 'moves'}`}</span><IconButton label="Download game PGN" onClick={() => downloadPgn()}><ArrowDownToLine size={15} /></IconButton></div><div className={`move-history ${history.length === 0 ? 'empty-history' : ''}`} ref={historyRef}>{history.length === 0 ? <div className="empty-history-content"><div className="mini-board"><span /><span /><span /><span /><span /><span /><span /><span /><span /><ChessPiece type="p" color="w" /></div><p>Every great game starts<br />with a single move.</p><span>Yours is up next.</span></div> : <><div className="history-column-labels"><span>#</span><span>White</span><span>Black</span></div>{Array.from({ length: Math.ceil(history.length / 2) }, (_, index) => <div className="move-row" key={index}><span className="move-number">{index + 1}.</span>{[index * 2, index * 2 + 1].map(ply => <button key={ply} disabled={!history[ply]} className={activePly === ply + 1 ? 'current-move' : ''} onClick={() => reviewMove(ply + 1)}>{history[ply]?.san || '—'}</button>)}</div>)}</>}</div><div className="history-navigation"><span>{isReview ? 'REVIEW' : 'LIVE GAME'}<i className={isReview ? 'review-dot' : ''} /></span><div><IconButton label="First position" disabled={!history.length || activePly === 0} onClick={() => reviewMove(0)}><ChevronsLeft size={17} /></IconButton><IconButton label="Previous move" disabled={!history.length || activePly === 0} onClick={() => reviewMove(activePly - 1)}><ChevronLeft size={17} /></IconButton><IconButton label="Next move" disabled={!isReview} onClick={() => reviewMove(activePly + 1)}><ChevronRight size={17} /></IconButton><IconButton label="Latest position" disabled={!isReview} onClick={() => setReviewPly(null)}><ChevronsRight size={17} /></IconButton></div></div></div>
              <div className="game-actions"><button className="primary-button" onClick={openNewGame}><Plus size={19} />New game<ArrowRight size={17} /></button><div className="secondary-actions"><button onClick={undoMove} disabled={!history.length || finished}><RotateCcw size={15} />Take back</button><span /><button onClick={() => setModal('resign')} disabled={finished || !history.length}><Flag size={15} />Resign</button></div></div>
            </> : <>{settingsContent()}<div className="settings-back"><button className="secondary-button" onClick={() => setPanelTab('game')}><ArrowLeft size={16} />Back to the game</button></div></>}
          </div>
          <div className="tip-card"><div className="tip-icon"><Lightbulb size={19} strokeWidth={1.5} /></div><div><div className="section-label">A THOUGHT FOR YOUR NEXT MOVE</div><h3>Good things start in the center.</h3><p>Control the middle of the board.<br />Give your pieces room to move.</p><button onClick={() => setModal('learn')}>A few more pointers <ArrowUpRight size={13} /></button></div></div>
          <div className="fair-play"><ShieldCheck size={14} /><span>No sign-up. No distractions. All chess.</span></div>
        </aside>
      </div>
      <footer className="page-footer"><span>One board. Endless possibilities.</span><span><span className="footer-diamond">◇</span> CHESS, IN ITS PUREST FORM</span></footer>
    </main>

    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    {(modal || promotion) && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) { setModal(null); setPromotion(null) } }}><div className={`modal ${modal === 'learn' ? 'learn-modal' : ''} ${modal === 'archive' ? 'archive-modal' : ''}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"><IconButton label="Close dialog" className="modal-close" onClick={() => { setModal(null); setPromotion(null) }}><X size={20} /></IconButton>
      {promotion ? <><div className="modal-symbol"><Crown size={26} /></div><div className="eyebrow">A WELL-EARNED UPGRADE</div><h2 id="modal-title">Choose your new piece.</h2><p>Your pawn made it to the other side.</p><div className="promotion-options">{(['q', 'r', 'b', 'n'] as PieceSymbol[]).map(type => <button key={type} onClick={() => commitMove({ ...promotion, promotion: type })} aria-label={`Promote to ${NAMES[type].toLowerCase()}`}><ChessPiece type={type} color={playerColor} /><span>{NAMES[type]}</span></button>)}</div></> : modal === 'new' ? <><div className="modal-symbol"><Swords size={26} /></div><div className="eyebrow">A FRESH PERSPECTIVE</div><h2 id="modal-title">A new game. All possibility.</h2><p>{history.length && !finished ? 'This will replace your current game.' : 'Settle in. The board is yours.'}</p><div className="new-game-settings"><label>Play as</label><div className="color-options"><button className={newColor === 'w' ? 'chosen' : ''} onClick={() => setNewColor('w')}><ChessPiece type="k" color="w" /><span>White</span>{newColor === 'w' && <Check size={13} />}</button><button className={newColor === 'b' ? 'chosen' : ''} onClick={() => setNewColor('b')}><ChessPiece type="k" color="b" /><span>Black</span>{newColor === 'b' && <Check size={13} />}</button><button className={newColor === 'random' ? 'chosen' : ''} onClick={() => setNewColor('random')}><Sparkles size={25} /><span>Surprise me</span>{newColor === 'random' && <Check size={13} />}</button></div><label htmlFor="new-difficulty">Your challenge</label><div className="form-select"><select id="new-difficulty" value={newLevel} onChange={event => setNewLevel(Number(event.target.value))}>{LEVELS.map((item, index) => <option key={item.name} value={index + 1}>{item.name} — Level {index + 1}</option>)}</select><ChevronDown size={16} /></div><label htmlFor="time-control">Time control</label><div className="form-select"><select id="time-control" value={newTimed ? '10' : 'none'} onChange={event => setNewTimed(event.target.value === '10')}><option value="10">10 minutes · A little focus</option><option value="none">No clock · Take your time</option></select><Clock3 size={16} /></div></div><button className="primary-button" onClick={startNewGame}>Let’s play<ArrowRight size={18} /></button><div className="modal-footnote">White moves first. A good game starts here.</div></> : modal === 'resign' ? <><div className="modal-symbol"><Flag size={26} /></div><h2 id="modal-title">Call it a good game?</h2><p>If you resign, the computer wins this game.<br />There is always another board, another chance.</p><div className="modal-button-row"><button className="secondary-button" onClick={() => setModal(null)}>Keep playing</button><button className="primary-button" onClick={() => { setEndReason('resigned'); setModal(null) }}>Resign game</button></div></> : modal === 'result' ? <><div className="modal-symbol"><Trophy size={29} /></div><div className="eyebrow">THAT’S A GAME</div><h2 id="modal-title">{resultTitle}</h2><p>{resultDetail}</p><div className="result-stats"><div><strong>{Math.ceil(history.length / 2)}</strong><span>moves played</span></div><div><strong>{LEVELS[level - 1].name}</strong><span>your opponent</span></div></div><button className="primary-button" onClick={openNewGame}><Plus size={18} />Another game<ArrowRight size={18} /></button><button className="text-button" onClick={() => setModal(null)}>Take a look at the board</button></> : modal === 'preferences' ? <><div className="modal-symbol"><Settings2 size={25} /></div><h2 id="modal-title">The little details.</h2>{settingsContent()}</> : modal === 'learn' ? <><div className="modal-symbol"><BookOpen size={25} /></div><div className="eyebrow">EVERYONE STARTS SOMEWHERE</div><h2 id="modal-title">A simple game. Endless depth.</h2><p>Your goal: put the other king in check, with no legal escape. That is checkmate.</p><div className="piece-guide">{([
        ['k', 'The King', 'One square in any direction. Keep your king safe.'],
        ['q', 'The Queen', 'Any distance in a straight line, in any direction.'],
        ['r', 'The Rook', 'Any distance along a rank or file.'],
        ['b', 'The Bishop', 'Any distance on a diagonal.'],
        ['n', 'The Knight', 'Two squares, then one to the side. It can jump over pieces.'],
        ['p', 'The Pawn', 'One square forward, two on its first move. Captures one square diagonally.'],
      ] as [PieceSymbol, string, string][]).map(([type, name, description]) => <div key={type}><span><ChessPiece type={type} color="w" /></span><h3>{name}</h3><p>{description}</p></div>)}</div><div className="special-rules"><details><summary>Three special moves<ChevronDown size={16} /></summary><p><strong>Castling:</strong> Move your king two squares toward a rook to move both pieces. Neither piece can have moved. The king cannot cross an attacked square.</p><p><strong>En passant:</strong> When a pawn advances two squares beside your pawn, you can capture it as if it moved one square. This is only possible on the next move.</p><p><strong>Promotion:</strong> A pawn that reaches the last rank becomes a queen, rook, bishop, or knight.</p></details><details><summary>A good place to start<Lightbulb size={16} /></summary><p>Control the center with your pawns. Develop your knights and bishops. Castle to protect your king. Before every move, look for threats.</p></details></div><button className="primary-button" onClick={() => setModal(null)}>Back to the board<ArrowRight size={17} /></button></> : modal === 'archive' ? <><div className="modal-symbol"><History size={25} /></div><div className="eyebrow">EVERY GAME IS A LITTLE PROGRESS</div><h2 id="modal-title">Your time at the board.</h2><p>Finished games stay here, on this device.</p>{archive.length ? <div className="archive-list">{archive.map(item => <div className="archive-item" key={item.id}><span className="archive-game-icon"><Swords size={22} /></span><div><strong>{item.title}</strong><span>{new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {item.moves} moves · {LEVELS[item.level - 1].name}</span></div><IconButton label="Download saved game" onClick={() => downloadPgn(item.pgn, item.id)}><ArrowDownToLine size={18} /></IconButton></div>)}</div> : <div className="archive-empty"><ChessPiece type="n" color="w" /><h3>Your story starts with a game.</h3><p>Finish your first game to add it to your collection.</p></div>}<button className="primary-button" onClick={() => setModal(null)}>Back to your game<ArrowRight size={18} /></button></> : null}
    </div></div>}
  </div>
}

export default App
