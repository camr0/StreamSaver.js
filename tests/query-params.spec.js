const { test, expect } = require('@playwright/test')

/**
 * The query-param surface exists so this page can be driven without a tap —
 * from CI, and from contexts where a click is not available (the iOS Simulator
 * drive-by `simctl openurl`).
 *
 * It also makes the page's contract checkable: the payload must be EXACTLY
 * `size * 1024 * 1024` bytes, because that number is what goes out as
 * Content-Length. Safari finalises a download from Content-Length rather than
 * from the stream closing, so a page that declares a size it does not deliver
 * leaves the download stuck at "downloading" forever even when the bytes on
 * disk look fine. That is what `bytesWritten === expectedBytes` guards.
 */
test.describe('query-param automation surface', () => {
  test('?auto=1 starts without a click and reports completion', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?auto=1&size=2&filename=qp-auto.txt')

    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 })

    const state = await page.evaluate(() => window.__testState)
    expect(state.phase).toBe('done')
    expect(state.error).toBe(null)
    expect(state.expectedBytes).toBe(2 * 1024 * 1024)
    expect(state.chunkCount).toBe(2)
    // The invariant that matters: every declared byte was actually written.
    expect(state.bytesWritten).toBe(state.expectedBytes)
  })

  test('?size and ?chunk control the payload and its chunking', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?auto=1&size=3&chunk=512')

    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 })

    const state = await page.evaluate(() => window.__testState)
    expect(state.expectedBytes).toBe(3 * 1024 * 1024)
    expect(state.chunkCount).toBe(6) // 3 MiB in 512 KiB chunks
    expect(state.bytesWritten).toBe(state.expectedBytes)
  })

  test('a non-aligned chunk size still totals exactly size*1024*1024', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?auto=1&size=1&chunk=300')

    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 })

    const state = await page.evaluate(() => window.__testState)
    expect(state.expectedBytes).toBe(1048576)
    expect(state.chunkCount).toBe(4) // ceil(1024 / 300)
    expect(state.bytesWritten).toBe(1048576)
  })

  test('?mode=blob takes the in-memory path', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?auto=1&size=1&mode=blob&filename=qp-blob.txt')

    await expect(page.locator('#status')).toHaveText(/blob fallback/, { timeout: 30000 })

    const state = await page.evaluate(() => window.__testState)
    expect(state.phase).toBe('done')
    expect(state.bytesWritten).toBe(1048576)
  })

  test('?fallbackChunk reaches streamSaver.fallbackChunkSize', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?fallbackChunk=64')
    expect(await page.evaluate(() => streamSaver.fallbackChunkSize)).toBe(64 * 1024)

    // ...and the library default is unchanged when the param is absent.
    await page.goto('/examples/auto-plain-text.html')
    expect(await page.evaluate(() => streamSaver.fallbackChunkSize)).toBe(256 * 1024)
  })

  test('?credit is threaded to the mitm transport', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?credit=3')
    expect(await page.evaluate(() => streamSaver.mitm)).toContain('credit=3')

    await page.goto('/examples/auto-plain-text.html')
    expect(await page.evaluate(() => streamSaver.mitm)).toBe('../mitm.html')
  })

  test('malformed params fall back to defaults instead of breaking', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html?auto=1&size=0&chunk=-5&credit=abc')

    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 })

    const state = await page.evaluate(() => window.__testState)
    expect(state.expectedBytes).toBe(1048576) // size=0 is invalid -> 1 MiB
    expect(state.bytesWritten).toBe(state.expectedBytes)
  })

  test('the default element ids and status text still work (no params)', async ({ page }) => {
    await page.goto('/examples/auto-plain-text.html')

    // The pre-existing click-driven flow must keep working unchanged.
    await page.fill('#filename', 'qp-default.txt')
    await page.fill('#size', '1')
    await page.click('#start')

    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 })

    const state = await page.evaluate(() => window.__testState)
    expect(state.config.mode).toBe('sw')
    expect(state.bytesWritten).toBe(1048576)
  })
})
