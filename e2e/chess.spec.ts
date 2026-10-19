import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { Color, Square } from 'chess.js'
import { applyBattleAction, createBattle, SUPPORT_BONUS, UNIT_STATS } from '../src/battle'
import type { BattleState } from '../src/battle'
import type { BattleResponse } from '../src/battle.worker'

const SAVE_KEY = 'chess-but-real-health-v2'
const ARCHIVE_KEY = 'chess-but-real-health-archive-v2'
const RANGED_FEN = '7k/8/8/8/p7/8/8/R3K3 w - - 0 1'
const SQUARES = Array.from({ length: 64 }, (_, index) => `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}` as Square)

type SavedBattle = {
  version: 2
  session: { id: string; states: BattleState[]; resigned: Color | null }
  mode: 'local' | 'computer' | 'online'
  playerColor: Color
  level: number
  settings: { sound: boolean; hints: boolean; theme: 'mono' | 'sage' | 'walnut' | 'slate' }
}

type WorkerProbe = { responses: BattleResponse[]; errors: string[] }

const board = (page: Page) => page.getByRole('group', { name: /^Chess board\./ })
const square = (page: Page, name: Square) => board(page).locator(`[data-square="${name}"]`)
const log = (page: Page) => page.locator('.combat-log .log-item')
const turn = (page: Page) => page.locator('.turn-banner strong')
const target = (page: Page, name: Square) => page.locator('.inspector-panel .target-row').filter({ has: page.locator('.target-square', { hasText: new RegExp(`^${name}$`) }) })

async function savedBattle(page: Page): Promise<SavedBattle> {
  const raw = await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)
  expect(raw).not.toBeNull()
  return JSON.parse(raw!) as SavedBattle
}

async function liveState(page: Page) {
  const saved = await savedBattle(page)
  return saved.session.states[saved.session.states.length - 1]
}

async function settled(page: Page) {
  await expect(turn(page)).not.toContainText(/in progress|on the move\./i)
  await expect(board(page).locator('.moving-piece, .attack-layer')).toHaveCount(0)
}

async function expectPosition(page: Page, state: BattleState) {
  const labels = Object.fromEntries(SQUARES.map(name => {
    const piece = state.board[name]
    return [name, `${name}, ${piece ? `${piece.color === 'w' ? 'white' : 'black'} ${UNIT_STATS[piece.type].name.toLowerCase()}, ${piece.hp} of ${UNIT_STATS[piece.type].health} health` : 'empty'}`]
  }))
  await expect.poll(() => board(page).locator('[data-square]').evaluateAll(items => Object.fromEntries(items.map(item => [
    item.getAttribute('data-square'),
    item.getAttribute('aria-label')?.replace(/, (?:attack for.*|legal move)$/, ''),
  ])))).toEqual(labels)
  await expect(board(page).locator('.piece-health')).toHaveCount(Object.keys(state.board).length)
}

async function seedBattle(page: Page, state = createBattle(), options: Partial<Pick<SavedBattle, 'mode' | 'playerColor' | 'level'>> = {}) {
  await page.goto('./')
  await expect(board(page)).toBeVisible()
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).not.toBeNull()
  const saved: SavedBattle = {
    version: 2,
    session: { id: 'e2e-health-battle', states: [state], resigned: null },
    mode: 'local',
    playerColor: 'w',
    level: 1,
    settings: { sound: false, hints: true, theme: 'mono' },
    ...options,
  }
  await page.evaluate(({ key, archiveKey, value }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.removeItem(archiveKey)
  }, { key: SAVE_KEY, archiveKey: ARCHIVE_KEY, value: saved })
  await page.reload()
  await expect.poll(() => savedBattle(page)).toEqual(saved)
  await settled(page)
  await expectPosition(page, state)
  return saved
}

async function act(page: Page, from: Square, to: Square) {
  await settled(page)
  const count = (await savedBattle(page)).session.states.length
  await square(page, from).click()
  await expect(square(page, from)).toHaveAttribute('aria-pressed', 'true')
  await square(page, to).click()
  await expect.poll(async () => (await savedBattle(page)).session.states.length).toBe(count + 1)
  await settled(page)
  return liveState(page)
}

async function expectNoOverflow(page: Page, element: Locator = board(page)) {
  const width = page.viewportSize()!.width
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width)
  const bounds = await element.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
}

async function expectNoCards(page: Page) {
  await expect(page.locator('.command-tray, .tactic-card, .command-points, .capture-panel, .capture-badge')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /play card|draw card|use card|command point|tactic/i })).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await seedBattle(page)
})

test('Chess Royale loads assets, moves, and exports from its deployment path @pages', async ({ page, baseURL, request }) => {
  const base = new URL(baseURL!)
  await expect(page).toHaveURL(base.href)
  await expect(page).toHaveTitle('Chess Royale — Every hit counts.')
  const brand = page.getByRole('button', { name: 'Chess Royale home', exact: true })
  await expect(brand).toBeVisible()
  await expect(brand).toHaveText('Chess Royale')
  await brand.click()
  const dialog = page.getByRole('dialog', { name: 'A new kind of chess.' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.eyebrow')).toHaveText('CHESS ROYALE · HEALTH EDITION')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()

  const scripts = await page.locator('script[type="module"][src]').evaluateAll(items => items.map(item => (item as HTMLScriptElement).src))
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(items => items.map(item => (item as HTMLLinkElement).href).filter(href => new URL(href).origin === location.origin))
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveCount(1)
  const favicon = await icon.evaluate(item => (item as HTMLLinkElement).href)
  expect(scripts.length).toBeGreaterThan(0)
  const assets = [
    ...scripts.map(url => ({ url, contentType: /(?:java|ecma)script/i })),
    ...styles.map(url => ({ url, contentType: /text\/css/i })),
    { url: favicon, contentType: /image\/svg\+xml/i },
  ]
  for (const { url, contentType } of assets) {
    expect(new URL(url).origin).toBe(base.origin)
    expect(new URL(url).pathname.startsWith(base.pathname)).toBe(true)
    const response = await request.get(url)
    expect(response.ok(), url).toBe(true)
    expect(response.headers()['content-type'], url).toMatch(contentType)
  }

  const initial = await liveState(page)
  const moved = await act(page, 'e2', 'e4')
  expect(moved).toEqual(applyBattleAction(initial, { from: 'e2', to: 'e4' }))
  await expectPosition(page, moved)
  await expect(turn(page)).toHaveText('Black to act.')
  const saved = await savedBattle(page)
  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export battle', exact: true }).click()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toBe(`chess-royale-${saved.session.id.slice(0, 8)}.json`)
  expect(await download.failure()).toBeNull()
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(saved)
})

test('the initial board has 32 health bars and no command or tactic controls', async ({ page }) => {
  await expect(board(page).locator('.battle-square')).toHaveCount(64)
  await expect(board(page).locator('.piece-health-fill')).toHaveCount(32)
  await expect(board(page).locator('.piece-hp')).toHaveCount(32)
  await expect(board(page).getByRole('button', { name: /, white / })).toHaveCount(16)
  await expect(board(page).getByRole('button', { name: /, black / })).toHaveCount(16)
  await expect(turn(page)).toHaveText('White to act.')
  await expect(page.locator('.log-empty')).toContainText('The first move starts the story.')
  await expect(log(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'First position', exact: true })).toBeDisabled()
  await expect(page.locator('.player-total strong')).toHaveText(['2,440', '2,440'])
  await expectNoCards(page)
})

test('a selected pawn shows its health, stats, and legal moves', async ({ page }) => {
  await square(page, 'e2').click()
  await expect(square(page, 'e2')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.inspector-panel h2')).toHaveText('Pawn')
  await expect(page.locator('.unit-hp-label')).toContainText('100 / 100')
  await expect(page.locator('.unit-stats').first()).toContainText('35BASE DAMAGE')
  await expect(page.locator('.turn-banner')).toContainText('Pawn on e2 · 100/100 HP · 0 attack targets')
  await expect(board(page).locator('.move-dot')).toHaveCount(2)
  await expect(square(page, 'e3')).toHaveAccessibleName('e3, empty, legal move')
  await expect(square(page, 'e4')).toHaveAccessibleName('e4, empty, legal move')
  await square(page, 'e2').click()
  await expect(square(page, 'e2')).toHaveAttribute('aria-pressed', 'false')
  await expect(board(page).locator('.move-dot')).toHaveCount(0)
  const after = await act(page, 'e2', 'e4')
  await expect(square(page, 'e2')).toHaveAccessibleName('e2, empty')
  await expect(square(page, 'e4')).toHaveAccessibleName('e4, white pawn, 100 of 100 health')
  await expect(turn(page)).toHaveText('Black to act.')
  expect(after.lastAction).toMatchObject({ from: 'e2', to: 'e4', kind: 'move', color: 'w' })
})

test('an illegal move leaves the saved state and health unchanged', async ({ page }) => {
  const before = await savedBattle(page)
  await square(page, 'e2').click()
  await square(page, 'e5').click()
  await expect(log(page)).toHaveCount(0)
  await expect(turn(page)).toHaveText('White to act.')
  expect(await savedBattle(page)).toEqual(before)
  await page.reload()
  await expectPosition(page, before.session.states[0])
})

test('ranged hits persist damage before a lethal hit moves the rook', async ({ page }) => {
  const initial = createBattle(RANGED_FEN)
  await seedBattle(page, initial)
  await square(page, 'a1').click()
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, black pawn, 100 of 100 health, attack for 49 damage')
  await expect(square(page, 'a4')).toHaveAttribute('title', '49 damage · 3 squares · 30% range reduction · 51 HP remains')
  await square(page, 'a4').click()
  await expect(board(page).locator('.attack-layer')).toBeVisible()
  await expect(turn(page)).toHaveText('Attack in progress.')
  await expect.poll(async () => (await liveState(page)).board.a4?.hp).toBe(51)
  await expect(square(page, 'a1')).toHaveAttribute('aria-disabled', 'true')
  await square(page, 'a1').dispatchEvent('click')
  await square(page, 'a4').dispatchEvent('click')
  await settled(page)
  await expectPosition(page, await liveState(page))
  await expect(square(page, 'a1')).toHaveAccessibleName('a1, white rook, 240 of 240 health')
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, black pawn, 51 of 100 health')
  await expect(page.locator('.combat-summary')).toContainText('Both pieces hold position. 51 target HP remains.')
  await expect(log(page)).toHaveCount(1)
  await act(page, 'h8', 'g8')
  const second = await act(page, 'a1', 'a4')
  expect(second.board.a4?.hp).toBe(2)
  expect(second.board.a1).toEqual(initial.board.a1)
  await expect(square(page, 'a4').locator('.piece-health')).toHaveClass(/critical/)
  await act(page, 'g8', 'h8')
  await square(page, 'a1').click()
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, black pawn, 2 of 100 health, attack for 2 damage, lethal capture')
  await expect(square(page, 'a4').locator('.damage-preview')).toHaveText('CAPTURE')
  await square(page, 'a4').click()
  await expect.poll(async () => (await liveState(page)).ply).toBe(5)
  await settled(page)
  await expect(square(page, 'a1')).toHaveAccessibleName('a1, empty')
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, white rook, 240 of 240 health')
  await expect(board(page).locator('.piece-health')).toHaveCount(3)
  await expect(page.locator('.combat-summary')).toContainText('Target defeated. The attacker takes its square.')
  await expect(page.locator('.log-tag')).toHaveText(['KILL', 'MOVE', 'HIT', 'MOVE', 'HIT'])
  const saved = await savedBattle(page)
  await page.reload()
  await expectPosition(page, saved.session.states[5])
  expect(await savedBattle(page)).toEqual(saved)
})

test('near and far targets show different damage and range reductions', async ({ page }) => {
  await seedBattle(page, createBattle('7k/8/8/8/8/8/p7/R2b3K w - - 0 1'))
  await square(page, 'a1').click()
  await expect(square(page, 'a2')).toHaveAccessibleName('a2, black pawn, 100 of 100 health, attack for 70 damage')
  await expect(square(page, 'd1')).toHaveAccessibleName('d1, black bishop, 140 of 140 health, attack for 49 damage')
  await expect(target(page, 'a2')).toContainText('1 sq away · 0% reduction')
  await expect(target(page, 'a2').locator('.target-damage')).toHaveText('−70')
  await expect(target(page, 'd1')).toContainText('3 sq away · 30% reduction')
  await expect(target(page, 'd1').locator('.target-damage')).toHaveText('−49')
  await target(page, 'd1').click()
  await expect.poll(async () => (await liveState(page)).board.d1?.hp).toBe(91)
  await settled(page)
  await expect(square(page, 'a2')).toHaveAccessibleName('a2, black pawn, 100 of 100 health')
})

test('a pawn attacks only one diagonal square forward, like a chess capture', async ({ page }) => {
  await seedBattle(page, createBattle('7k/8/8/5n2/8/3n4/4P3/4K3 w - - 0 1'))
  await square(page, 'e2').click()
  await expect(square(page, 'd3')).toHaveAccessibleName('d3, black knight, 180 of 180 health, attack for 35 damage')
  await expect(square(page, 'f5')).toHaveAccessibleName('f5, black knight, 180 of 180 health')
  await expect(page.locator('.inspector-panel .target-row')).toHaveCount(1)
  await expect(target(page, 'd3')).toContainText('1 sq away')
  await expect(page.locator('.inspector-panel')).toContainText('Spear')
  await square(page, 'f5').click()
  await expect(log(page)).toHaveCount(0)
})

test('allies covering the target add support damage and a support marker', async ({ page }) => {
  const lone = createBattle('7k/8/8/n7/8/8/8/R3K3 w - - 0 1')
  await seedBattle(page, lone)
  await square(page, 'a1').click()
  await expect(square(page, 'a5')).toHaveAccessibleName('a5, black knight, 180 of 180 health, attack for 39 damage')
  await expect(square(page, 'a5').locator('.damage-preview')).not.toHaveClass(/supported/)
  await expect(target(page, 'a5')).not.toContainText('support')

  const supported = createBattle('7k/8/8/n7/1P6/8/8/R3K3 w - - 0 1')
  await seedBattle(page, supported)
  await square(page, 'a1').click()
  await expect(square(page, 'a5')).toHaveAccessibleName('a5, black knight, 180 of 180 health, attack for 46 damage')
  await expect(square(page, 'a5').locator('.damage-preview')).toHaveClass(/supported/)
  await expect(square(page, 'a5').locator('.support-pips')).toHaveText('▲')
  await expect(target(page, 'a5')).toContainText('+1 support')
  await expect(page.locator('.inspector-panel')).toContainText(`+${SUPPORT_BONUS}`)
  await target(page, 'a5').click()
  await expect.poll(async () => (await liveState(page)).board.a5?.hp).toBe(134)
  await settled(page)
  await expect(log(page).first()).toContainText('+1 support')
  await expect(log(page).first()).toContainText('Cannon')
})

test('friendly and enemy blockers stop ranged attack previews', async ({ page }) => {
  for (const blocker of ['P', 'p']) {
    const initial = createBattle(`7k/8/8/q7/8/${blocker}7/8/R6K w - - 0 1`)
    await seedBattle(page, initial)
    await square(page, 'a1').click()
    await expect(square(page, 'a2')).toHaveAccessibleName('a2, empty, legal move')
    await expect(square(page, 'a4')).toHaveAccessibleName('a4, empty')
    await expect(square(page, 'a5')).toHaveAccessibleName('a5, black queen, 220 of 220 health')
    await expect(target(page, 'a5')).toHaveCount(0)
    await expect(page.locator('.inspector-panel .target-row')).toHaveCount(blocker === 'p' ? 1 : 0)
    if (blocker === 'p') await expect(square(page, 'a3')).toHaveAccessibleName('a3, black pawn, 100 of 100 health, attack for 60 damage')
    await square(page, 'a5').click()
    expect(await liveState(page)).toEqual(initial)
    await expect(log(page)).toHaveCount(0)
  }
})

test('one attack consumes the turn and prevents another attack by the same army', async ({ page }) => {
  await seedBattle(page, createBattle(RANGED_FEN))
  await act(page, 'a1', 'a4')
  const after = await savedBattle(page)
  await expect(turn(page)).toHaveText('Black to act.')
  await square(page, 'a1').click()
  await expect(square(page, 'a1')).toHaveAttribute('aria-pressed', 'false')
  await expect(board(page).locator('.damage-preview')).toHaveCount(0)
  await square(page, 'a4').click()
  await expect(square(page, 'a4')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.inspector-panel h2')).toHaveText('Pawn')
  await expect(page.locator('.unit-hp-label')).toContainText('51 / 100')
  expect(await savedBattle(page)).toEqual(after)
  await page.keyboard.press('Escape')
  await act(page, 'h8', 'g8')
  expect((await liveState(page)).turn).toBe('w')
})

test('a lethal attack on the king ends the battle and locks the board', async ({ page }) => {
  const initial = createBattle('8/8/8/8/k7/8/8/R3K3 w - - 0 1')
  initial.board.a4!.hp = 49
  await seedBattle(page, initial)
  const after = await act(page, 'a1', 'a4')
  expect(after.winner).toBe('w')
  expect(after.board.a4).toMatchObject({ type: 'r', color: 'w', hp: 240 })
  await expect(turn(page)).toHaveText('White wins.')
  await expect(page.locator('.result-banner')).toContainText('White wins the battle.')
  await expect(page.getByRole('button', { name: 'Resign', exact: true })).toBeDisabled()
  await expect(board(page).locator('[aria-disabled="true"]')).toHaveCount(64)
  await square(page, 'a4').dispatchEvent('click')
  await square(page, 'a5').dispatchEvent('click')
  expect(await liveState(page)).toEqual(after)
  await page.reload()
  await expect(turn(page)).toHaveText('White wins.')
  await expectPosition(page, after)
})

test('a damaged piece keeps its health after a move and reload', async ({ page }) => {
  const initial = createBattle(RANGED_FEN)
  initial.board.a1!.hp = 83
  await seedBattle(page, initial)
  await square(page, 'a1').click()
  await expect(page.locator('.inspector-panel')).toContainText('Wounded. Damage stays between turns.')
  await expect(page.locator('.unit-hp-label')).toContainText('83 / 240')
  await square(page, 'a1').click()
  const after = await act(page, 'a1', 'b1')
  expect(after.board.b1).toEqual({ ...initial.board.a1, moved: true })
  await expect(square(page, 'b1')).toHaveAccessibleName('b1, white rook, 83 of 240 health')
  await expect(square(page, 'b1').locator('.piece-hp')).toHaveText('83')
  const width = await square(page, 'b1').locator('.piece-health-fill').evaluate(element => parseFloat((element as HTMLElement).style.width))
  expect(width).toBeCloseTo(83 / 240 * 100)
  await page.reload()
  await expectPosition(page, after)
  expect((await liveState(page)).board.b1?.hp).toBe(83)
})

test('take back restores exact health and action history across reload', async ({ page }) => {
  const initial = createBattle(RANGED_FEN)
  initial.board.a1!.hp = 173
  await seedBattle(page, initial)
  const hit = await act(page, 'a1', 'a4')
  const savedHit = await savedBattle(page)
  await page.reload()
  await expectPosition(page, hit)
  expect(await savedBattle(page)).toEqual(savedHit)
  await act(page, 'h8', 'g8')
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expect.poll(() => liveState(page)).toEqual(hit)
  await expectPosition(page, hit)
  await expect(log(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expect.poll(() => liveState(page)).toEqual(initial)
  await expectPosition(page, initial)
  await expect(log(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  await page.reload()
  await expectPosition(page, initial)
  expect((await savedBattle(page)).session.states).toEqual([initial])
})

test('take back restores a defeated target with its exact health', async ({ page }) => {
  const initial = createBattle(RANGED_FEN)
  initial.board.a1!.hp = 99
  initial.board.a4!.hp = 2
  await seedBattle(page, initial)
  await act(page, 'a1', 'a4')
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, white rook, 99 of 240 health')
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expectPosition(page, initial)
  await expect(square(page, 'a4').locator('.piece-hp')).toHaveText('2')
  expect(await liveState(page)).toEqual(initial)
})

test('history review shows past health and returns to the unchanged live battle', async ({ page }) => {
  const initial = createBattle(RANGED_FEN)
  await seedBattle(page, initial)
  const hit = await act(page, 'a1', 'a4')
  const live = await act(page, 'h8', 'g8')
  const saved = await savedBattle(page)
  await page.locator('.log-copy').last().click()
  await expect(turn(page)).toContainText('Review')
  await expectPosition(page, hit)
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeDisabled()
  await square(page, 'a1').dispatchEvent('click')
  await square(page, 'b1').dispatchEvent('click')
  expect(await savedBattle(page)).toEqual(saved)
  await page.getByRole('button', { name: 'First position', exact: true }).click()
  await expectPosition(page, initial)
  await page.getByRole('button', { name: 'Next action', exact: true }).click()
  await expectPosition(page, hit)
  await page.getByRole('button', { name: 'Latest position', exact: true }).click()
  await expect(turn(page)).toHaveText('White to act.')
  await expectPosition(page, live)
  await page.getByRole('button', { name: 'Previous action', exact: true }).click()
  await expectPosition(page, hit)
  await page.getByRole('button', { name: 'Return to the live battle', exact: true }).click()
  await expectPosition(page, live)
  expect(await savedBattle(page)).toEqual(saved)
})

test('queen promotion uses a modal and preserves the health ratio', async ({ page }) => {
  const initial = createBattle('7k/P7/8/8/8/8/8/4K3 w - - 0 1')
  initial.board.a7!.hp = 25
  await seedBattle(page, initial)
  await square(page, 'a7').click()
  await square(page, 'a8').click()
  const dialog = page.getByRole('dialog', { name: 'Choose your new piece.' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Promotion keeps the same percentage of health.')
  await expect(dialog.getByRole('button', { name: /^Promote to / })).toHaveCount(4)
  expect(await liveState(page)).toEqual(initial)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await liveState(page)).toEqual(initial)
  await square(page, 'a7').click()
  await square(page, 'a8').click()
  await dialog.getByRole('button', { name: 'Promote to queen', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await liveState(page)).board.a8?.type).toBe('q')
  await settled(page)
  await expect(square(page, 'a8')).toHaveAccessibleName('a8, white queen, 55 of 220 health')
  await expect(square(page, 'a8').locator('.piece-health-fill')).toHaveAttribute('style', 'width: 25%;')
  expect((await liveState(page)).board.a8).toMatchObject({ id: initial.board.a7!.id, type: 'q', hp: 55, moved: true })
  const saved = await savedBattle(page)
  await page.reload()
  await expectPosition(page, saved.session.states[1])
})

test('the black perspective and board flip preserve health and square controls', async ({ page }) => {
  await seedBattle(page, createBattle(), { playerColor: 'b' })
  const saved = await savedBattle(page)
  await expect(board(page).locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')
  await expect(board(page).locator('[data-square]').last()).toHaveAttribute('data-square', 'a8')
  await expect(page.locator('.file-coordinates span')).toHaveText('hgfedcba'.split(''))
  await page.getByRole('button', { name: 'Flip board', exact: true }).click()
  await expect(board(page).locator('[data-square]').first()).toHaveAttribute('data-square', 'a8')
  await expect(page.locator('.file-coordinates span')).toHaveText('abcdefgh'.split(''))
  expect(await savedBattle(page)).toEqual(saved)
  await act(page, 'e2', 'e4')
  await act(page, 'e7', 'e5')
  await expect(square(page, 'e5')).toHaveAccessibleName('e5, black pawn, 100 of 100 health')
  await page.getByRole('button', { name: 'Flip board', exact: true }).click()
  await expect(board(page).locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')
})

test('the computer worker returns one legal action without fallback or cards @pages', async ({ page, baseURL }) => {
  await seedBattle(page, createBattle(), { mode: 'computer', level: 1 })
  await page.evaluate(() => {
    const probe: WorkerProbe = { responses: [], errors: [] }
    Object.assign(window, { workerProbe: probe })
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', (event: MessageEvent<BattleResponse>) => probe.responses.push(event.data))
        this.addEventListener('error', event => probe.errors.push(event.message || 'Worker load failed'))
        this.addEventListener('messageerror', () => probe.errors.push('Worker response failed'))
      }
    }
  })
  const workerStarted = page.waitForEvent('worker', { predicate: worker => worker.url().includes('battle.worker') })
  await square(page, 'e2').click()
  await square(page, 'e4').click()
  const worker = await workerStarted
  const workerURL = new URL(worker.url())
  const base = new URL(baseURL!)
  expect(workerURL.origin).toBe(base.origin)
  expect(workerURL.pathname.startsWith(base.pathname)).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { workerProbe: WorkerProbe }).workerProbe.responses.length)).toBe(1)
  await expect.poll(async () => (await savedBattle(page)).session.states.length).toBe(3)
  await settled(page)
  await expect(turn(page)).toHaveText('Your turn. Move or attack.')
  const probe = await page.evaluate(() => (window as typeof window & { workerProbe: WorkerProbe }).workerProbe)
  expect(probe.errors).toEqual([])
  expect(probe.responses).toHaveLength(1)
  const response = probe.responses[0]
  expect(response.requestId).toBe(1)
  expect(response.move).not.toBeNull()
  const saved = await savedBattle(page)
  const [initial, human, computer] = saved.session.states
  expect(applyBattleAction(initial, { from: 'e2', to: 'e4' })).toEqual(human)
  expect(computer.lastAction).toMatchObject({ color: 'b', ply: 2, ...response.move! })
  const reply = computer.lastAction!
  expect(applyBattleAction(human, { from: reply.from, to: reply.to, ...(reply.promotion ? { promotion: reply.promotion } : {}) })).toEqual(computer)
  await expectPosition(page, computer)
  await expect(log(page)).toHaveCount(2)
  await expectNoCards(page)
  await page.reload()
  await expectPosition(page, computer)
  expect(await savedBattle(page)).toEqual(saved)
  await page.getByRole('button', { name: 'Take back', exact: true }).click()
  await expectPosition(page, initial)
  await expect(log(page)).toHaveCount(0)
})

test('dialogs trap focus and Escape restores the opener', async ({ page }) => {
  const cases = [
    { opener: page.getByRole('button', { name: 'Preferences', exact: true }), title: 'Make the board yours.' },
    { opener: page.getByRole('button', { name: 'New game', exact: true }), title: 'A new kind of chess.' },
    { opener: page.getByRole('button', { name: 'How to play', exact: true }), title: 'Every piece has a life.' },
    { opener: page.getByRole('button', { name: 'My games', exact: true }), title: 'Your recent battles.' },
    { opener: page.getByRole('button', { name: 'Resign', exact: true }), title: 'End this battle?' },
  ]
  for (const { opener, title } of cases) {
    await opener.click()
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    const items = dialog.locator('button:not(:disabled), input, select, [tabindex="0"]')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(items.last()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  }
})

test('the rules show all unit stats, weapons, support, and deterministic health rules', async ({ page }) => {
  await page.getByRole('button', { name: 'Read the rules', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Every piece has a life.' })
  await expect(dialog.locator('.rule-unit')).toHaveCount(12)
  for (const stats of Object.values(UNIT_STATS)) {
    const unit = dialog.locator('.rule-unit').filter({ hasText: `${stats.health} HP` }).filter({ hasText: stats.name })
    await expect(unit).toContainText(`${stats.damage} DMG`)
    await expect(unit).toContainText(stats.weaponName)
    await expect(dialog.locator('.rule-unit').filter({ has: page.getByText(stats.weaponName, { exact: true }) }).first()).toBeVisible()
  }
  await expect(dialog).toContainText('Each turn permits one move or one attack.')
  await expect(dialog).toContainText('A nonlethal attack leaves both pieces in place.')
  await expect(dialog).toContainText('A piece can attack any square it could capture in normal chess.')
  await expect(dialog).toContainText('Pawns strike one square diagonally forward.')
  await expect(dialog).toContainText('Each square after the first reduces base damage by 15 percentage points.')
  await expect(dialog).toContainText('Damage never falls below 35% of base damage.')
  await expect(dialog).toContainText(`Each ally that could also attack the target adds ${SUPPORT_BONUS}% of base damage.`)
  await expect(dialog).toContainText('There are no random rolls.')
  await expect(dialog).toContainText('There is no check or checkmate.')
  await expect(dialog).not.toContainText(/command points|tactic cards|capture chance|roll below/i)
  await dialog.getByRole('button', { name: 'Back to the battle', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('hint, sound, and theme preferences persist without changing legal actions', async ({ page }) => {
  await seedBattle(page, createBattle(RANGED_FEN))
  const before = await liveState(page)
  await square(page, 'a1').click()
  await expect(board(page).locator('.move-dot')).not.toHaveCount(0)
  await expect(square(page, 'a4').locator('.damage-preview')).toBeVisible()
  await page.getByRole('button', { name: 'Preferences', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Make the board yours.' })
  await dialog.getByLabel('Move and damage hints', { exact: true }).uncheck()
  await expect(dialog.getByLabel('Attack sounds', { exact: true })).not.toBeChecked()
  for (const theme of ['sage', 'walnut', 'slate']) {
    await dialog.getByRole('combobox', { name: 'Board theme', exact: true }).selectOption(theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  }
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(board(page).locator('.move-dot, .damage-preview')).toHaveCount(0)
  expect(await liveState(page)).toEqual(before)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'slate')
  expect((await savedBattle(page)).settings).toEqual({ sound: false, hints: false, theme: 'slate' })
  await square(page, 'a1').click()
  await expect(board(page).locator('.move-dot, .damage-preview')).toHaveCount(0)
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, black pawn, 100 of 100 health, attack for 49 damage')
  await square(page, 'a4').click()
  await expect.poll(async () => (await liveState(page)).board.a4?.hp).toBe(51)
  await settled(page)
  await page.getByRole('button', { name: 'Enable sound', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mute sound', exact: true })).toBeVisible()
  await expect.poll(async () => (await savedBattle(page)).settings.sound).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Mute sound', exact: true })).toBeVisible()
})

test('a new local battle resets health and keeps the old battle in the archive', async ({ page }) => {
  await seedBattle(page, createBattle(RANGED_FEN))
  const hit = await act(page, 'a1', 'a4')
  const old = await savedBattle(page)
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'A new kind of chess.' })
  await expect(dialog.getByRole('button', { name: 'Local friend', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Local friend', exact: true }).click()
  await dialog.getByLabel('Play as', { exact: true }).selectOption('b')
  await dialog.getByRole('button', { name: 'Start battle', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expectPosition(page, createBattle())
  await expect(log(page)).toHaveCount(0)
  const fresh = await savedBattle(page)
  expect(fresh.session.id).not.toBe(old.session.id)
  expect(fresh).toMatchObject({ mode: 'local', playerColor: 'b', session: { resigned: null } })
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), ARCHIVE_KEY)).toEqual([old.session])
  await page.reload()
  await expectPosition(page, createBattle())
  await page.getByRole('button', { name: 'My games', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Your recent battles.' })
  await expect(archive.locator('.target-row')).toHaveCount(1)
  await expect(archive).toContainText('1 actions')
  await archive.locator('.target-row').click()
  await expect(turn(page)).toContainText('Review')
  await expectPosition(page, hit)
  expect((await savedBattle(page)).session).toEqual(old.session)
  await page.getByRole('button', { name: 'Return to the live battle', exact: true }).click()
  await expect(turn(page)).toHaveText('Black to act.')
})

test('resignation requires confirmation and a replacement archives the result', async ({ page }) => {
  await act(page, 'e2', 'e4')
  const before = await savedBattle(page)
  await page.getByRole('button', { name: 'Resign', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'End this battle?' })
  await dialog.getByRole('button', { name: 'Keep playing', exact: true }).click()
  expect(await savedBattle(page)).toEqual(before)
  await page.getByRole('button', { name: 'Resign', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'End this battle?' })
  await dialog.getByRole('button', { name: 'Resign', exact: true }).click()
  await expect(turn(page)).toHaveText('White wins.')
  await expect(page.locator('.result-banner')).toContainText('Black resigned.')
  await expect.poll(async () => (await savedBattle(page)).session.resigned).toBe('b')
  const resigned = await savedBattle(page)
  await page.reload()
  await expect(turn(page)).toHaveText('White wins.')
  await page.getByRole('button', { name: 'Play again', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start battle', exact: true }).click()
  await expectPosition(page, createBattle())
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), ARCHIVE_KEY)).toEqual([resigned.session])
})

test('board keyboard controls select a piece, move focus, and clear selection', async ({ page }) => {
  await square(page, 'e2').focus()
  await page.keyboard.press('Enter')
  await expect(square(page, 'e2')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(square(page, 'e3')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(square(page, 'e2')).toHaveAttribute('aria-pressed', 'false')
  await square(page, 'e2').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await liveState(page)).ply).toBe(1)
  await settled(page)
  await expect(square(page, 'e3')).toHaveAccessibleName('e3, white pawn, 100 of 100 health')
})

test('reduced motion completes nonlethal and lethal actions with exact health', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const initial = createBattle(RANGED_FEN)
  initial.board.a4!.hp = 51
  await seedBattle(page, initial)
  const hit = await act(page, 'a1', 'a4')
  expect(hit.board.a4?.hp).toBe(2)
  await expect(square(page, 'a4')).toHaveAccessibleName('a4, black pawn, 2 of 100 health')
  await act(page, 'h8', 'g8')
  const kill = await act(page, 'a1', 'a4')
  expect(kill.board.a1).toBeUndefined()
  expect(kill.board.a4).toMatchObject({ type: 'r', hp: 240 })
  await expectPosition(page, kill)
  await expect(log(page)).toHaveCount(3)
  await expect(turn(page)).toHaveText('Black to act.')
  await page.reload()
  await expectPosition(page, kill)
})

for (const width of [360, 390]) {
  test(`mobile ${width}px has no overflow with selected targets and dialogs`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await seedBattle(page, createBattle('7k/8/8/8/8/8/p7/R2b3K w - - 0 1'))
    await expectNoOverflow(page)
    await square(page, 'a1').click()
    await expect(page.locator('.inspector-panel .target-row')).toHaveCount(2)
    await expectNoOverflow(page)
    const openers = [
      page.getByRole('button', { name: 'Read the rules', exact: true }),
      page.getByRole('button', { name: 'Preferences', exact: true }),
      page.getByRole('button', { name: 'New game', exact: true }),
    ]
    for (const opener of openers) {
      await opener.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expectNoOverflow(page, dialog)
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
      await expectNoOverflow(page)
    }
    const pawn = createBattle('7k/P7/8/8/8/8/8/4K3 w - - 0 1')
    pawn.board.a7!.hp = 50
    await seedBattle(page, pawn)
    await square(page, 'a7').click()
    await square(page, 'a8').click()
    const promotion = page.getByRole('dialog', { name: 'Choose your new piece.' })
    await expectNoOverflow(page, promotion)
    await promotion.getByRole('button', { name: 'Promote to queen', exact: true }).click()
    await settled(page)
    await expect(square(page, 'a8')).toHaveAccessibleName('a8, white queen, 110 of 220 health')
    await expectNoOverflow(page)
  })
}
