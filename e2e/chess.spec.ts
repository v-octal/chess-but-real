import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Chess, SQUARES } from 'chess.js'
import type { Square } from 'chess.js'

const SAVE_KEY = 'chess-club-game-v1'
const ARCHIVE_KEY = 'chess-club-archive-v1'
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

type SavedGame = {
  pgn: string
  playerColor: 'w' | 'b'
  level: number
  seconds: { w: number; b: number }
  timed: boolean
  endReason: 'resigned' | 'timeout-w' | 'timeout-b' | null
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
  const game = new Chess()
  game.loadPgn((await savedGame(page)).pgn)
  return game
}

async function expectPosition(page: Page, game: Chess) {
  const labels = Object.fromEntries(SQUARES.map(name => {
    const piece = game.get(name)
    return [name, `${name}, ${piece ? `${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}` : 'empty'}`]
  }))
  await expect.poll(() => board(page).locator('[data-square]').evaluateAll(squares =>
    Object.fromEntries(squares.map(item => [item.getAttribute('data-square'), item.getAttribute('aria-label')?.replace(', legal move', '')])),
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
  const saved: SavedGame = {
    pgn: game.pgn(),
    playerColor: 'w',
    level: 1,
    seconds: { w: 600, b: 600 },
    timed: false,
    endReason: null,
    id: 'e2e-seeded-game',
    settings: { sound: false, hints: true, coordinates: true, theme: 'sage' },
  }
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: saved })
  await page.reload()
  await expectPosition(page, game)
  return game
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
    await expect(board(page)).toBeVisible()
    await expectNoOverflow(page)
  })
})
