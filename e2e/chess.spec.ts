import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Chess, SQUARES } from 'chess.js'
import type { Square } from 'chess.js'
import type { CaptureAttempt } from '../src/capture'

const SAVE_KEY = 'chess-club-game-v1'
const ARCHIVE_KEY = 'chess-club-archive-v1'
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

type SavedGame = {
  pgn: string
  playerColor: 'w' | 'b'
  level: number
  seconds: { w: number; b: number }
  timed: boolean
  endReason: 'resigned' | 'timeout-w' | 'timeout-b' | 'capture-w' | 'capture-b' | null
  captures?: CaptureAttempt[]
  record?: { startFen: string; moves: string[]; headers: Record<string, string>; comments: { fen: string; comment: string }[] }
  id: string
  settings: { sound: boolean; hints: boolean; coordinates: boolean; theme: 'sage' | 'walnut' | 'slate' }
}

const board = (page: Page) => page.getByRole('group', { name: /^Chess board\./ })
const square = (page: Page, name: Square) => board(page).locator(`[data-square="${name}"]`)
const moves = (page: Page) => page.locator('.move-row button:enabled')

async function savedGame(page: Page): Promise<SavedGame> {
  const raw = await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)
  expect(raw).not.toBeNull()
  return JSON.parse(raw!) as SavedGame
}

async function savedPosition(page: Page) {
  const saved = await savedGame(page)
  if (!saved.record) {
    const game = new Chess()
    game.loadPgn(saved.pgn)
    return game
  }
  const game = new Chess(saved.record.startFen)
  const comments = new Map(saved.record.comments.map(entry => [entry.fen, entry.comment]))
  const restoreComment = () => {
    const comment = comments.get(game.fen())
    if (comment) game.setComment(comment)
  }
  restoreComment()
  saved.record.moves.forEach(move => { game.move(move); restoreComment() })
  Object.entries(saved.record.headers).forEach(([key, value]) => game.setHeader(key, value))
  return game
}

async function expectPosition(page: Page, game: Chess) {
  const labels = Object.fromEntries(SQUARES.map(name => {
    const piece = game.get(name)
    return [name, `${name}, ${piece ? `${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}` : 'empty'}`]
  }))
  await expect.poll(() => board(page).locator('[data-square]').evaluateAll(squares =>
    Object.fromEntries(squares.map(item => [item.getAttribute('data-square'), item.getAttribute('aria-label')?.replace(/, legal move(?:, \d+% capture chance)?/, '')])),
  )).toEqual(labels)
}

async function playOpening(page: Page) {
  await square(page, 'e2').click()
  await square(page, 'e4').click()
  await expect(moves(page)).toHaveCount(2)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect.poll(async () => (await savedPosition(page)).history().length).toBe(2)
  const game = await savedPosition(page)
  expect(game.history()[0]).toBe('e4')
  expect(game.history({ verbose: true })[1].color).toBe('b')
  expect(game.turn()).toBe('w')
  await expectPosition(page, game)
  return game
}

async function seedGame(page: Page, pgn: string) {
  const game = new Chess()
  game.loadPgn(pgn)
  expect(game.turn()).toBe('w')
  expect(game.isGameOver()).toBe(false)
  const saved: SavedGame & { mode: 'computer' } = {
    pgn: game.pgn(),
    playerColor: 'w',
    level: 1,
    seconds: { w: 600, b: 600 },
    timed: false,
    endReason: null,
    id: 'e2e-seeded-game',
    settings: { sound: false, hints: true, coordinates: true, theme: 'sage' },
    mode: 'computer',
  }
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: saved })
  await page.reload()
  await expectPosition(page, game)
  return game
}

async function mockCaptureRoll(page: Page, value: 0 | 0xffffffff) {
  await page.addInitScript(roll => {
    const original = crypto.getRandomValues.bind(crypto)
    const state = window as typeof window & { captureRolls: number }
    state.captureRolls = 0
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1) {
        state.captureRolls += 1
        array.fill(roll)
        return array
      }
      return original(array)
    }
  }, value)
  await page.reload()
  await expect(board(page)).toBeVisible()
}

async function captureRolls(page: Page) {
  return page.evaluate(() => (window as typeof window & { captureRolls: number }).captureRolls)
}

function expectQuietReplies(game: Chess) {
  const passed = new Chess()
  passed.loadPgn(game.pgn())
  passed.move(null)
  const replies = passed.moves({ verbose: true })
  expect(replies.length).toBeGreaterThan(0)
  expect(replies.every(move => !move.captured)).toBe(true)
}

async function expectNoOverflow(page: Page) {
  const width = page.viewportSize()!.width
  await expect.poll(() => page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  )).toBeLessThanOrEqual(width)
  const bounds = await board(page).boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(board(page)).toBeVisible()
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).not.toBeNull()
  const fresh: SavedGame & { mode: 'computer' } = {
    pgn: '',
    playerColor: 'w',
    level: 3,
    seconds: { w: 600, b: 600 },
    timed: true,
    endReason: null,
    id: 'e2e-computer-game',
    settings: { sound: true, hints: true, coordinates: true, theme: 'sage' },
    mode: 'computer',
  }
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: fresh })
  await page.reload()
  await expect(page.locator('.opponent-bar')).toContainText('The Computer')
})

test('initial board contains 32 pieces and an empty history', async ({ page }) => {
  await expect(board(page).locator('[data-square]')).toHaveCount(64)
  await expect(board(page).locator('.piece-container')).toHaveCount(32)
  await expect(board(page).getByRole('button', { name: /, white / })).toHaveCount(16)
  await expect(board(page).getByRole('button', { name: /, black / })).toHaveCount(16)
  await expectPosition(page, new Chess())
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect(page.locator('.move-count')).toHaveText('A fresh start')
  await expect(moves(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Resign', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'First position', exact: true })).toBeDisabled()
  expect((await savedPosition(page)).history()).toEqual([])
  expect(await page.evaluate(key => localStorage.getItem(key), ARCHIVE_KEY)).toBeNull()
})

test('e2 shows only the e3 and e4 legal hints', async ({ page }) => {
  await square(page, 'e2').click()
  await expect(square(page, 'e2')).toHaveAttribute('aria-pressed', 'true')
  await expect(board(page).getByRole('button', { name: /, legal move$/ })).toHaveCount(2)
  for (const destination of ['e3', 'e4'] as const) {
    await expect(square(page, destination)).toHaveAccessibleName(`${destination}, empty, legal move`)
    await expect(square(page, destination).locator('.legal-dot')).toBeVisible()
  }
  await square(page, 'e2').click()
  await expect(square(page, 'e2')).toHaveAttribute('aria-pressed', 'false')
  await expect(board(page).locator('.legal-dot')).toHaveCount(0)
})

test('an illegal e2 to e5 move leaves the board and history unchanged', async ({ page }) => {
  const original = (await savedGame(page)).pgn
  await square(page, 'e2').click()
  await square(page, 'e5').click()
  await expectPosition(page, new Chess())
  await expect(moves(page)).toHaveCount(0)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  expect((await savedGame(page)).pgn).toBe(original)
  await page.reload()
  await expectPosition(page, new Chess())
  await expect(moves(page)).toHaveCount(0)
})

test('e2 to e4 receives one legal computer reply and persists after reload', async ({ page }) => {
  const game = await playOpening(page)
  await expect(square(page, 'e2')).toHaveAccessibleName('e2, empty')
  await expect(square(page, 'e4')).toHaveAccessibleName('e4, white pawn')
  await expect(moves(page).first()).toHaveText('e4')
  await expect(moves(page).nth(1)).toHaveText(game.history()[1])
  await page.reload()
  await expect(moves(page)).toHaveCount(2)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expectPosition(page, game)
  expect((await savedPosition(page)).fen()).toBe(game.fen())
})

test('history review does not change the live game and navigation restores it', async ({ page }) => {
  const live = await playOpening(page)
  const afterWhite = new Chess()
  afterWhite.move('e4')
  await moves(page).first().click()
  await expect(page.locator('.history-navigation')).toContainText('REVIEW')
  await expectPosition(page, afterWhite)
  await square(page, 'e4').click()
  await square(page, 'e5').click()
  await expectPosition(page, afterWhite)
  expect((await savedPosition(page)).fen()).toBe(live.fen())
  await page.getByRole('button', { name: 'First position', exact: true }).click()
  await expectPosition(page, new Chess())
  await expect(page.getByRole('button', { name: 'Previous move', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Next move', exact: true }).click()
  await expectPosition(page, afterWhite)
  await page.getByRole('button', { name: 'Latest position', exact: true }).click()
  await expectPosition(page, live)
  await expect(page.locator('.history-navigation')).toContainText('LIVE GAME')
  await page.getByRole('button', { name: 'Previous move', exact: true }).click()
  await expectPosition(page, afterWhite)
  await page.getByRole('button', { name: 'Back to the live game', exact: true }).click()
  await expectPosition(page, live)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect(page.getByRole('button', { name: 'Next move', exact: true })).toBeDisabled()
})

test('take back removes the player move and the computer reply', async ({ page }) => {
  await playOpening(page)
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expectPosition(page, new Chess())
  await expect(moves(page)).toHaveCount(0)
  await expect(page.locator('.move-count')).toHaveText('A fresh start')
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Resign', exact: true })).toBeDisabled()
  expect((await savedPosition(page)).history()).toEqual([])
  await page.reload()
  await expectPosition(page, new Chess())
  await expect(moves(page)).toHaveCount(0)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
})

test('a new black game resets the old game and the computer moves first', async ({ page }) => {
  await playOpening(page)
  const oldId = (await savedGame(page)).id
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A new game. All possibility.' })
  await dialog.getByRole('button', { name: 'Black', exact: true }).click()
  await dialog.getByLabel('Your challenge').selectOption('1')
  await dialog.getByLabel('Time control').selectOption('none')
  await dialog.getByRole('button', { name: 'Let’s play', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(moves(page)).toHaveCount(1)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect(board(page)).toHaveAccessibleName('Chess board. Black to move')
  await expect(board(page).locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')
  await expect(page.locator('.you-bar')).toContainText('Playing as black')
  await expect(page.locator('.clock')).toHaveText(['∞', '∞'])
  const saved = await savedGame(page)
  expect(saved.id).not.toBe(oldId)
  expect(saved).toMatchObject({ playerColor: 'b', level: 1, timed: false, endReason: null })
  const game = await savedPosition(page)
  expect(game.history()).toHaveLength(1)
  expect(game.history({ verbose: true })[0].color).toBe('w')
  expect(game.turn()).toBe('b')
  await expectPosition(page, game)
  const reply = game.moves({ verbose: true })[0]
  await square(page, reply.from).click()
  await square(page, reply.to).click()
  await expect(moves(page)).toHaveCount(3)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  const continued = await savedPosition(page)
  expect(continued.history()[1]).toBe(reply.san)
  await expectPosition(page, continued)
})

test('resignation requires confirmation and archives one persistent game', async ({ page, isMobile }) => {
  const game = await playOpening(page)
  const id = (await savedGame(page)).id
  await page.getByRole('button', { name: 'Resign', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Call it a good game?' })
  await dialog.getByRole('button', { name: 'Keep playing', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect((await savedGame(page)).endReason).toBeNull()
  await page.getByRole('button', { name: 'Resign', exact: true }).click()
  await dialog.getByRole('button', { name: 'Resign game', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'A good game. A new lesson.' })
  await expect(dialog).toContainText('You resigned. The computer wins.')
  await dialog.getByRole('button', { name: 'Take a look at the board', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Resign', exact: true })).toBeDisabled()
  await square(page, 'd2').click()
  await square(page, 'd4').click()
  await expectPosition(page, game)
  expect((await savedGame(page)).endReason).toBe('resigned')
  const archive = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), ARCHIVE_KEY)
  expect(archive).toHaveLength(1)
  expect(archive[0]).toMatchObject({ id, title: 'You resigned. The computer wins.', moves: 1, color: 'w', level: 3 })
  const archived = new Chess()
  archived.loadPgn(archive[0].pgn)
  expect(archived.fen()).toBe(game.fen())
  await page.reload()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  if (isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('button', { name: /^My games/ }).click()
  const archiveDialog = page.getByRole('dialog', { name: 'Your time at the board.' })
  await expect(archiveDialog.locator('.archive-item')).toHaveCount(1)
  await expect(archiveDialog).toContainText('You resigned. The computer wins.')
  await expect(archiveDialog.getByRole('button', { name: 'Download saved game', exact: true })).toBeEnabled()
  const downloadEvent = page.waitForEvent('download')
  await archiveDialog.getByRole('button', { name: 'Download saved game', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe(`chess-club-${id.slice(0, 8)}.pgn`)
  expect(await download.failure()).toBeNull()
})

test('settings control hints, coordinates, sound, and all board themes', async ({ page }) => {
  await square(page, 'e2').click()
  await expect(board(page).locator('.legal-dot')).toHaveCount(2)
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  const settings = page.locator('.game-panel')
  for (const name of ['Legal moves', 'Board coordinates', 'Move sounds']) {
    await expect(settings.getByRole('switch', { name, exact: true })).toBeChecked()
    await settings.getByRole('switch', { name, exact: true }).click()
    await expect(settings.getByRole('switch', { name, exact: true })).not.toBeChecked()
  }
  await expect(board(page).locator('.legal-dot')).toHaveCount(0)
  await expect(board(page).getByRole('button', { name: /, legal move$/ })).toHaveCount(0)
  await expect(page.locator('.rank-labels')).toBeHidden()
  await expect(page.locator('.file-labels')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible()
  const colors = new Set<string>()
  for (const theme of ['walnut', 'sage', 'slate'] as const) {
    const option = settings.getByRole('button', { name: `${theme} board`, exact: true })
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
    await expect(settings.locator('.theme-option[aria-pressed="true"]')).toHaveCount(1)
    await expect(page.locator('.board-frame')).toHaveClass(new RegExp(`theme-${theme}`))
    const expectedColors = { walnut: 'rgb(231, 212, 179)', sage: 'rgb(230, 233, 212)', slate: 'rgb(220, 228, 231)' }
    await expect(square(page, 'e4')).toHaveCSS('background-color', expectedColors[theme])
    colors.add(await square(page, 'e4').evaluate(element => getComputedStyle(element).backgroundColor))
  }
  expect(colors.size).toBe(3)
  await page.reload()
  await expect(page.locator('.board-frame')).toHaveClass(/theme-slate/)
  await expect(page.locator('.rank-labels')).toBeHidden()
  await square(page, 'e2').click()
  await expect(board(page).locator('.legal-dot')).toHaveCount(0)
  expect((await savedGame(page)).settings).toEqual({ sound: false, hints: false, coordinates: false, theme: 'slate' })
  await page.getByRole('button', { name: 'Board preferences', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'The little details.' })
  for (const name of ['Legal moves', 'Board coordinates', 'Move sounds']) {
    await expect(dialog.getByRole('switch', { name, exact: true })).not.toBeChecked()
    await dialog.getByRole('switch', { name, exact: true }).click()
  }
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(board(page).locator('.legal-dot')).toHaveCount(2)
  await expect(page.locator('.rank-labels')).toBeVisible()
  await expect(page.locator('.file-labels')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mute sound', exact: true })).toBeVisible()
})

test('capture odds appear before an equal unprotected pawn capture', async ({ page }) => {
  const game = await seedGame(page, new Chess('7k/8/8/4p3/3P4/8/8/K7 w - - 0 1').pgn())
  const original = (await savedGame(page)).pgn
  await expect(board(page).locator('.capture-badge')).toHaveCount(0)
  await expect(page.locator('.capture-result')).toHaveCount(0)
  await square(page, 'd4').click()
  await expect(square(page, 'e5').locator('.capture-badge')).toHaveText('70%')
  await expect(square(page, 'e5')).toHaveAccessibleName('e5, black pawn, legal move, 70% capture chance')
  await expect(page.getByRole('button', { name: 'Attempt capture on e5, 70% chance', exact: true })).toBeVisible()
  await expectPosition(page, game)
  await expect(moves(page)).toHaveCount(0)
  await expect(page.locator('.capture-result')).toHaveCount(0)
  expect((await savedGame(page)).pgn).toBe(original)
  expect((await savedGame(page)).captures ?? []).toEqual([])
})

test('a successful capture persists its outcome and log across reload and take back', async ({ page }) => {
  const original = await seedGame(page, new Chess('7k/8/8/4p3/3P4/8/8/K7 w - - 0 1').pgn())
  await mockCaptureRoll(page, 0)
  await square(page, 'd4').click()
  await expect(square(page, 'e5').locator('.capture-badge')).toHaveText('70%')
  await square(page, 'e5').click()
  await expect(moves(page)).toHaveCount(2)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  const outcome = page.locator('.capture-result')
  await expect(outcome).toHaveClass(/capture-success/)
  await expect(outcome).toContainText('Capture succeeded')
  await expect(outcome).toContainText('d4 → e5')
  await expect(outcome).toContainText('70%')
  await expect(square(page, 'd4')).toHaveAccessibleName('d4, empty')
  await expect(square(page, 'e5')).toHaveAccessibleName('e5, white pawn')
  const saved = await savedGame(page)
  expect(saved.captures).toEqual([expect.objectContaining({
    ply: 1, from: 'd4', to: 'e5', piece: 'p', target: 'p', color: 'w',
    chance: 70, strengthBonus: 0, supportBonus: 0, attackers: 0, defenders: 0, roll: 0, success: true,
  })])
  expect(saved.endReason).toBeNull()
  const captured = await savedPosition(page)
  expect(captured.history()[0]).toBe('dxe5')
  expect(captured.history({ verbose: true })[1]).toMatchObject({ color: 'b' })
  expect(captured.history({ verbose: true })[1].captured).toBeUndefined()
  await expectPosition(page, captured)
  expect(await captureRolls(page)).toBe(1)
  await page.reload()
  await expectPosition(page, captured)
  await expect(outcome).toHaveClass(/capture-success/)
  await expect(outcome).toContainText('Capture succeeded')
  expect((await savedGame(page)).captures).toEqual(saved.captures)
  expect((await savedGame(page)).pgn).toBe(saved.pgn)
  expect(await captureRolls(page)).toBe(0)
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expectPosition(page, original)
  await expect(moves(page)).toHaveCount(0)
  await expect(outcome).toHaveCount(0)
  await expect.poll(async () => (await savedGame(page)).captures).toEqual([])
  expect((await savedPosition(page)).history()).toEqual([])
  await page.reload()
  await expectPosition(page, original)
  await expect(outcome).toHaveCount(0)
  expect((await savedGame(page)).captures).toEqual([])
  expect(await captureRolls(page)).toBe(0)
})

test('a failed capture keeps both pieces, consumes the turn, and permits a quiet computer reply', async ({ page }) => {
  const original = await seedGame(page, new Chess('8/8/8/R3p2k/3PP3/8/8/K7 w - - 0 1').pgn())
  expectQuietReplies(original)
  await mockCaptureRoll(page, 0xffffffff)
  await square(page, 'd4').click()
  await expect(square(page, 'e5').locator('.capture-badge')).toHaveText('78%')
  await square(page, 'e5').click()
  await expect(moves(page)).toHaveCount(2)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect(moves(page).first()).toHaveText('d4×e5 failed')
  const outcome = page.locator('.capture-result')
  await expect(outcome).toHaveClass(/capture-failure/)
  await expect(outcome).toContainText('Capture failed')
  await expect(outcome).toContainText('Both pieces stay in place.')
  await expect(square(page, 'd4')).toHaveAccessibleName('d4, white pawn')
  await expect(square(page, 'e5')).toHaveAccessibleName('e5, black pawn')
  const saved = await savedGame(page)
  expect(saved.pgn).toMatch(/\b1\. --/)
  expect(saved.captures).toEqual([expect.objectContaining({
    ply: 1, from: 'd4', to: 'e5', piece: 'p', target: 'p', color: 'w',
    chance: 78, roll: 0xffffffff / 2 ** 32, success: false,
  })])
  expect(saved.endReason).toBeNull()
  const failed = await savedPosition(page)
  expect(failed.history()[0]).toBe('--')
  const history = failed.history({ verbose: true })
  expect(history[0].before.split(' ')[0]).toBe(original.fen().split(' ')[0])
  expect(history[0].after.split(' ')[0]).toBe(original.fen().split(' ')[0])
  expect(history[0].after.split(' ')[1]).toBe('b')
  expect(history[1]).toMatchObject({ color: 'b', piece: 'k' })
  expect(history[1].captured).toBeUndefined()
  expect(failed.turn()).toBe('w')
  await expectPosition(page, failed)
  expect(await captureRolls(page)).toBe(1)
  await page.reload()
  await expectPosition(page, failed)
  await expect(moves(page)).toHaveCount(2)
  await expect(moves(page).first()).toHaveText('d4×e5 failed')
  await expect(outcome).toHaveClass(/capture-failure/)
  expect((await savedGame(page)).pgn).toBe(saved.pgn)
  expect((await savedGame(page)).captures).toEqual(saved.captures)
  expect(await captureRolls(page)).toBe(0)
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expectPosition(page, original)
  await expect(moves(page)).toHaveCount(0)
  await expect(outcome).toHaveCount(0)
  await expect.poll(async () => (await savedGame(page)).captures).toEqual([])
  expect((await savedPosition(page)).history()).toEqual([])
  await page.reload()
  await expectPosition(page, original)
  await expect(outcome).toHaveCount(0)
  expect((await savedGame(page)).captures).toEqual([])
})

test('a failed capture from check ends the game without changing the board', async ({ page }) => {
  const original = await seedGame(page, new Chess('R3r3/7k/8/8/8/8/8/4K3 w - - 0 1').pgn())
  expect(original.isCheck()).toBe(true)
  expect(original.moves()).toContain('Rxe8')
  await mockCaptureRoll(page, 0xffffffff)
  await square(page, 'a8').click()
  await expect(square(page, 'e8').locator('.capture-badge')).toHaveText('70%')
  await square(page, 'e8').click()
  const dialog = page.getByRole('dialog', { name: 'A good game. A new lesson.', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('The capture failed to escape check.')
  await expect(dialog).toContainText('Black wins.')
  await expectPosition(page, original)
  await expect(page.locator('.capture-result')).toHaveClass(/capture-failure/)
  await expect(moves(page)).toHaveCount(1)
  await expect(moves(page).first()).toHaveText('a8×e8 failed')
  await expect.poll(async () => (await savedGame(page)).endReason).toBe('capture-w')
  const saved = await savedGame(page)
  expect(saved.captures).toEqual([expect.objectContaining({
    ply: 1, from: 'a8', to: 'e8', piece: 'r', target: 'r', color: 'w',
    chance: 70, roll: 0xffffffff / 2 ** 32, success: false,
  })])
  expect((await savedPosition(page)).fen()).toBe(original.fen())
  expect((await savedPosition(page)).history()).toEqual([])
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  expect(await square(page, 'e1').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Boolean(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.modal-backdrop'))
  })).toBe(true)
  await square(page, 'e1').dispatchEvent('click')
  await square(page, 'd1').dispatchEvent('click')
  await expect(square(page, 'e1')).toHaveAttribute('aria-pressed', 'false')
  await expectPosition(page, original)
  expect((await savedGame(page)).pgn).toBe(saved.pgn)
  expect((await savedGame(page)).captures).toEqual(saved.captures)
  expect(await captureRolls(page)).toBe(1)
  await dialog.getByRole('button', { name: 'Take a look at the board', exact: true }).click()
  await page.getByRole('button', { name: 'First position', exact: true }).click()
  await expect(page.locator('.history-navigation')).toContainText('REVIEW')
  await expect(page.locator('.capture-result')).toHaveCount(0)
  await expectPosition(page, original)
  await page.getByRole('button', { name: 'Latest position', exact: true }).click()
  await expect(page.locator('.capture-result')).toHaveClass(/capture-failure/)
  await expect(moves(page).first()).toHaveText('a8×e8 failed')
  await page.reload()
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('The capture failed to escape check.')
  await expectPosition(page, original)
  expect((await savedGame(page)).endReason).toBe('capture-w')
  expect((await savedGame(page)).captures).toEqual(saved.captures)
  expect(await captureRolls(page)).toBe(0)
})

test('en passant shows capture odds and removes the captured pawn on success', async ({ page }) => {
  const original = await seedGame(page, new Chess('7k/8/8/3Pp3/8/8/8/K7 w - e6 0 2').pgn())
  expect(original.moves({ verbose: true }).find(move => move.from === 'd5' && move.to === 'e6')?.isEnPassant()).toBe(true)
  await mockCaptureRoll(page, 0)
  await square(page, 'd5').click()
  await expect(square(page, 'e6').locator('.capture-badge')).toHaveText('70%')
  await expect(square(page, 'e6')).toHaveAccessibleName('e6, empty, legal move, 70% capture chance')
  await expectPosition(page, original)
  await square(page, 'e6').click()
  await expect(moves(page)).toHaveCount(2)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect(square(page, 'd5')).toHaveAccessibleName('d5, empty')
  await expect(square(page, 'e5')).toHaveAccessibleName('e5, empty')
  await expect(square(page, 'e6')).toHaveAccessibleName('e6, white pawn')
  await expect(page.locator('.capture-result')).toHaveClass(/capture-success/)
  const saved = await savedGame(page)
  expect(saved.captures).toEqual([expect.objectContaining({
    ply: 1, from: 'd5', to: 'e6', target: 'p', chance: 70, roll: 0, success: true,
  })])
  const captured = await savedPosition(page)
  expect(captured.history({ verbose: true })[0].isEnPassant()).toBe(true)
  await expectPosition(page, captured)
  expect(await captureRolls(page)).toBe(1)
  await page.reload()
  await expectPosition(page, captured)
  await expect(page.locator('.capture-result')).toHaveClass(/capture-success/)
  expect((await savedGame(page)).captures).toEqual(saved.captures)
  expect(await captureRolls(page)).toBe(0)
})

test('a failed capture promotion leaves the pawn unpromoted', async ({ page }) => {
  const original = await seedGame(page, new Chess('r6k/1P6/8/8/8/8/8/7K w - - 0 1').pgn())
  expectQuietReplies(original)
  expect(original.moves()).toContain('bxa8=Q+')
  await mockCaptureRoll(page, 0xffffffff)
  await square(page, 'b7').click()
  await expect(square(page, 'a8').locator('.capture-badge')).toHaveText('58%')
  await square(page, 'a8').click()
  const dialog = page.getByRole('dialog', { name: 'Choose your new piece.', exact: true })
  await expect(dialog).toBeVisible()
  await expectPosition(page, original)
  expect((await savedGame(page)).captures ?? []).toEqual([])
  expect(await captureRolls(page)).toBe(0)
  await dialog.getByRole('button', { name: 'Promote to queen', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(moves(page)).toHaveCount(2)
  await expect(moves(page).first()).toHaveText('b7×a8 failed')
  await expect(square(page, 'b7')).toHaveAccessibleName('b7, white pawn')
  await expect(board(page).getByRole('button', { name: /, white queen/ })).toHaveCount(0)
  await expect(page.locator('.capture-result')).toHaveClass(/capture-failure/)
  const saved = await savedGame(page)
  expect(saved.captures).toEqual([expect.objectContaining({
    ply: 1, from: 'b7', to: 'a8', piece: 'p', target: 'r', chance: 58,
    roll: 0xffffffff / 2 ** 32, success: false,
  })])
  const failed = await savedPosition(page)
  expect(failed.history()[0]).toBe('--')
  expect(failed.history({ verbose: true })[0].after.split(' ')[0]).toBe(original.fen().split(' ')[0])
  expect(failed.history({ verbose: true })[0].promotion).toBeUndefined()
  expect(failed.history({ verbose: true })[1].captured).toBeUndefined()
  expect(failed.turn()).toBe('w')
  await expectPosition(page, failed)
  expect(await captureRolls(page)).toBe(1)
  await page.reload()
  await expectPosition(page, failed)
  await expect(dialog).toBeHidden()
  await expect(square(page, 'b7')).toHaveAccessibleName('b7, white pawn')
  expect((await savedGame(page)).captures).toEqual(saved.captures)
  expect(await captureRolls(page)).toBe(0)
})

test('How to play explains capture odds and failure rules', async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'How to play', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A simple game. Endless depth.', exact: true })
  await expect(dialog).toBeVisible()
  const rules = dialog.locator('details').filter({ hasText: 'Probabilistic captures' })
  await expect(rules.getByText('Probabilistic captures', { exact: true })).toBeVisible()
  for (const text of [
    'Each legal capture starts with a 70% chance.',
    'Each strength point of advantage adds 3 percentage points',
    'Each extra ally that attacks the destination adds 8 percentage points.',
    'Each piece that protects the defender subtracts 8.',
    'The chance stays between 40% and 95%.',
    'A uniform random roll below the chance succeeds.',
    'A failed capture keeps both pieces in place and uses the turn.',
    'En passant also uses these odds.',
    'Promotion occurs only after success.',
    'A failed capture from check loses the game.',
  ]) await expect(rules).toContainText(text)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expectPosition(page, new Chess())
})

test('a legal seeded PGN permits king-side castling', async ({ page }) => {
  const game = await seedGame(page, '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6')
  expect(game.moves()).toContain('O-O')
  await square(page, 'e1').click()
  await expect(square(page, 'g1')).toHaveAccessibleName('g1, empty, legal move')
  await square(page, 'g1').click()
  await expect(moves(page)).toHaveCount(8)
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  const castled = await savedPosition(page)
  expect(castled.history()[6]).toBe('O-O')
  await expect(square(page, 'g1')).toHaveAccessibleName('g1, white king')
  await expect(square(page, 'f1')).toHaveAccessibleName('f1, white rook')
  await expect(square(page, 'e1')).toHaveAccessibleName('e1, empty')
  await expect(square(page, 'h1')).toHaveAccessibleName('h1, empty')
  await expectPosition(page, castled)
})

test('a legal seeded PGN permits promotion to a chosen piece', async ({ page }) => {
  const game = await seedGame(page, '1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2')
  await mockCaptureRoll(page, 0)
  expect(game.moves()).toContain('bxa8=Q')
  await square(page, 'b7').click()
  await square(page, 'a8').click()
  const dialog = page.getByRole('dialog', { name: 'Choose your new piece.' })
  await expect(dialog).toBeVisible()
  for (const piece of ['queen', 'rook', 'bishop', 'knight']) {
    await expect(dialog.getByRole('button', { name: `Promote to ${piece}`, exact: true })).toBeVisible()
  }
  expect((await savedPosition(page)).history()).toHaveLength(8)
  await dialog.getByRole('button', { name: 'Promote to queen', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(moves(page)).toHaveCount(10)
  const promoted = await savedPosition(page)
  expect(promoted.history()[8]).toBe('bxa8=Q')
  await expect(square(page, 'a8')).toHaveAccessibleName('a8, white queen')
  await expect(square(page, 'b7')).toHaveAccessibleName('b7, empty')
  await expectPosition(page, promoted)
})

test('game actions remain available in the settings tab', async ({ page }) => {
  await playOpening(page)
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  for (const name of ['New game', 'Take back', 'Resign']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
  }
  await page.getByRole('button', { name: 'Resign', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep playing', exact: true }).click()
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expectPosition(page, new Chess())
  await expect(page.getByRole('switch', { name: 'Legal moves', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A new game. All possibility.' })
  await expect(dialog.getByLabel('Your challenge')).toBeVisible()
  await expect(dialog.getByLabel('Time control')).toBeVisible()
  await dialog.getByRole('button', { name: 'Let’s play', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expectPosition(page, new Chess())
})

test('compact board tools retain difficulty, orientation, and sound controls', async ({ page }) => {
  await page.getByLabel('Computer difficulty', { exact: true }).selectOption('4')
  await expect(page.locator('.opponent-bar')).toContainText('Advanced · Level 4')
  await page.getByRole('button', { name: 'Flip board', exact: true }).click()
  await expect(board(page).locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible()
  const game = await playOpening(page)
  expect((await savedGame(page)).level).toBe(4)
  await page.getByRole('button', { name: 'Flip board', exact: true }).click()
  await expect(board(page).locator('[data-square]').first()).toHaveAttribute('data-square', 'a8')
  await expectPosition(page, game)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download game PGN', exact: true }).click()
  expect(await (await downloadEvent).failure()).toBeNull()
})

test('compact navigation keeps help, archives, and preferences accessible', async ({ page, isMobile }) => {
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  for (const [name, title] of [
    ['How to play', 'A simple game. Endless depth.'],
    ['My games', 'Your time at the board.'],
    ['Preferences', 'The little details.'],
  ]) {
    if (isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await navigation.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  }
  if (isMobile) {
    const open = page.getByRole('button', { name: 'Open navigation', exact: true })
    await open.click()
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('button', { name: 'Close navigation menu', exact: true }).click()
    await expect(open).toHaveAttribute('aria-expanded', 'false')
  }
  await expectPosition(page, new Chess())
})

test.describe('mobile', () => {
  for (const width of [360, 390]) {
    test(`the board and controls fit a ${width}px viewport without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await expectNoOverflow(page)
      await expect(board(page).locator('.piece-container')).toHaveCount(32)
      await playOpening(page)
      await expectNoOverflow(page)
      await page.getByRole('tab', { name: 'Settings', exact: true }).click()
      await expect(page.getByRole('switch', { name: 'Legal moves', exact: true })).toBeVisible()
      await expectNoOverflow(page)
      await page.getByRole('button', { name: 'Back to the game', exact: true }).click()
      await expect(moves(page)).toHaveCount(2)
    })
  }

  test('navigation opens and closes the guide, archive, preferences, and game', async ({ page }) => {
    const open = page.getByRole('button', { name: 'Open navigation', exact: true })
    const close = page.getByRole('button', { name: 'Close navigation', exact: true })
    const sidebar = page.locator('.sidebar')
    await open.click()
    await expect(sidebar).toHaveClass(/sidebar-open/)
    await expect(close).toBeVisible()
    await expectNoOverflow(page)
    await close.click({ position: { x: 350, y: 100 } })
    await expect(sidebar).not.toHaveClass(/sidebar-open/)
    await expect(close).toHaveCount(0)
    for (const [navigation, title] of [
      ['How to play', 'A simple game. Endless depth.'],
      ['My games', 'Your time at the board.'],
      ['Preferences', 'The little details.'],
    ]) {
      await open.click()
      await sidebar.getByRole('button', { name: navigation, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: title, exact: true })
      await expect(dialog).toBeVisible()
      await expect(sidebar).not.toHaveClass(/sidebar-open/)
      await expect(close).toHaveCount(0)
      await expectNoOverflow(page)
      if (navigation === 'My games') await expect(dialog).toContainText('Your story starts with a game.')
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    await open.click()
    await sidebar.getByRole('button', { name: 'Play computer', exact: true }).click()
    await expect(close).toHaveCount(0)
    const dialog = page.getByRole('dialog', { name: 'A new game. All possibility.' })
    await expect(dialog.getByRole('button', { name: 'Computer', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expectNoOverflow(page)
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await open.click()
    await sidebar.getByRole('button', { name: 'Play a friend', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Online friend', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('button', { name: 'Create invite link', exact: true })).toBeVisible()
    await expectNoOverflow(page)
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(board(page)).toBeVisible()
  })
})

test('the new game dialog offers only online and computer play', async ({ page }) => {
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A new game. All possibility.' })
  const options = dialog.getByRole('group', { name: 'Opponent' }).getByRole('button')
  await expect(options).toHaveText(['Online friend', 'Computer'])
  await expect(dialog.getByRole('button', { name: 'Same device', exact: true })).toHaveCount(0)
})

test('a new visitor starts against the computer', async ({ page }) => {
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(board(page)).toBeVisible()
  await expect(page.locator('.opponent-bar')).toContainText('The Computer')
  await expect(page.locator('.turn-status')).toHaveText('Your move')
  await expect(page.locator('#main-navigation .nav-item.nav-active')).toHaveText('Play computer')
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  const newGame = page.getByRole('dialog', { name: 'A new game. All possibility.' })
  await expect(newGame.getByRole('button', { name: 'Computer', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(newGame.getByLabel('Your challenge')).toBeVisible()
  await newGame.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.locator('.friend-actions').getByRole('button', { name: 'Play a friend', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A new game. All possibility.' })
  await expect(dialog.getByRole('button', { name: 'Online friend', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByLabel('Your challenge')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'I have a code', exact: true }).click()
  const join = page.getByRole('dialog', { name: 'Join a friend.' })
  await join.getByLabel('Game code').fill('ABC')
  await join.getByRole('button', { name: 'Join game', exact: true }).click()
  await expect(join.getByRole('alert')).toHaveText('This code is not valid. Check it and try again.')
})

async function hostInvite(page: Page, color: 'White' | 'Black') {
  await page.locator('.friend-actions').getByRole('button', { name: 'Play a friend', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A new game. All possibility.' })
  await dialog.getByRole('button', { name: color, exact: true }).click()
  await dialog.getByLabel('Time control').selectOption('none')
  await dialog.getByRole('button', { name: 'Create invite link', exact: true }).click()
  const invite = page.getByRole('dialog', { name: 'Invite a friend.' })
  await expect(invite.locator('.room-code')).toHaveText(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
  const link = await invite.getByLabel('Invite link').inputValue()
  expect(link).toMatch(/#play\/[2-9A-HJKMNP-Z]{8}$/)
  expect(link.length).toBeLessThan(120)
  return { invite, link, code: await invite.locator('.room-code').innerText() }
}

async function nextCaptureRoll(page: Page, roll: 0 | 0xffffffff) {
  await page.evaluate(value => {
    const original = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1) {
        crypto.getRandomValues = original
        array.fill(value)
        return array
      }
      return original(array)
    }
  }, roll)
}

async function expectConnected(white: Page, black: Page) {
  for (const player of [white, black]) {
    await expect(player.getByRole('dialog')).toBeHidden({ timeout: 40_000 })
    await expect(player.locator('.opponent-bar')).toContainText('Online')
  }
  await expect(white.locator('.you-bar')).toContainText('Playing as white')
  await expect(black.locator('.you-bar')).toContainText('Playing as black')
  await expect(white.locator('.turn-status')).toHaveText('Your move')
  await expect(black.locator('.turn-status')).toHaveText('Your friend has the next move.')
  await square(white, 'e2').click()
  await square(white, 'e4').click()
  await expect(black.locator('.turn-status')).toHaveText('Your move')
  await expect(square(black, 'e4')).toHaveAccessibleName('e4, white pawn')
  await square(black, 'e7').click()
  await square(black, 'e5').click()
  await expect(white.locator('.turn-status')).toHaveText('Your move')
  await expect(square(white, 'e5')).toHaveAccessibleName('e5, black pawn')
  await expect(moves(white)).toHaveText(['e4', 'e5'])
  await expect(moves(black)).toHaveText(['e4', 'e5'])
  await expect(white).not.toHaveURL(/#play\//)
  await expect(black).not.toHaveURL(/#play\//)
  await square(white, 'd2').click()
  await square(white, 'd4').click()
  await expect(black.locator('.turn-status')).toHaveText('Your move')
  await nextCaptureRoll(black, 0)
  await square(black, 'e5').click()
  await square(black, 'd4').click()
  for (const player of [white, black]) {
    await expect(player.locator('.capture-result')).toHaveClass(/capture-success/)
    await expect(square(player, 'd4')).toHaveAccessibleName('d4, black pawn')
    await expect(square(player, 'e5')).toHaveAccessibleName('e5, empty')
  }
  await expect(white.locator('.turn-status')).toHaveText('Your move')
  await nextCaptureRoll(white, 0xffffffff)
  await square(white, 'd1').click()
  await square(white, 'd4').click()
  for (const player of [white, black]) {
    await expect(player.locator('.capture-result')).toHaveClass(/capture-failure/)
    await expect(square(player, 'd1')).toHaveAccessibleName('d1, white queen')
    await expect(square(player, 'd4')).toHaveAccessibleName('d4, black pawn')
    await expect(moves(player)).toHaveCount(5)
  }
  await expect(black.locator('.turn-status')).toHaveText('Your move')
  expect((await savedGame(white)).captures).toEqual((await savedGame(black)).captures)
  expect((await savedPosition(white)).fen()).toBe((await savedPosition(black)).fen())
}

test.describe('online friends', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop covers the online link.')
  test.describe.configure({ timeout: 90_000 })

  test('a friend joins from a short invite link with no reply', async ({ page, browser, baseURL }) => {
    const { link } = await hostInvite(page, 'White')
    const guest = await browser.newPage({ baseURL })
    await guest.goto(link)
    await expect(guest.getByRole('dialog', { name: 'Joining your friend.' })).toBeVisible()
    await expectConnected(page, guest)
    await guest.close()
  })

  test('a friend joins by typing the short code', async ({ page, browser, baseURL }) => {
    const { code } = await hostInvite(page, 'Black')
    const guest = await browser.newPage({ baseURL })
    await guest.goto('./')
    await guest.getByRole('button', { name: 'Join', exact: true }).click()
    const join = guest.getByRole('dialog', { name: 'Join a friend.' })
    await join.getByLabel('Game code').fill(code.toLowerCase())
    await join.getByRole('button', { name: 'Join game', exact: true }).click()
    await expectConnected(guest, page)
    await guest.close()
  })

  test('the manual code still connects two friends', async ({ page, browser, baseURL }) => {
    const { invite } = await hostInvite(page, 'White')
    await invite.getByRole('button', { name: 'Use a manual code instead', exact: true }).click()
    const manual = page.getByRole('dialog', { name: 'Share this link.' })
    const longLink = manual.getByLabel('Invite link')
    await expect(longLink).toHaveValue(/#join\/cc1/, { timeout: 15_000 })
    const guest = await browser.newPage({ baseURL })
    await guest.goto(await longLink.inputValue())
    const reply = guest.getByRole('dialog', { name: 'Send this reply.' }).getByLabel('Reply code')
    await expect(reply).toHaveValue(/^cc1/, { timeout: 15_000 })
    await manual.getByLabel('Friend reply').fill(await reply.inputValue())
    await manual.getByRole('button', { name: 'Connect', exact: true }).click()
    await expectConnected(page, guest)
    await guest.close()
  })
})
