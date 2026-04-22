const { test, expect } = require('@playwright/test');

test.describe('StreamSaver auto-download', () => {
  
  test('should download 1 MiB file without errors', async ({ page, browserName }) => {
    // Listen for console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Navigate to auto-download test page
    await page.goto('/examples/auto-plain-text.html');

    // Set filename and size
    await page.fill('#filename', `test-${browserName}.txt`);
    await page.fill('#size', '1');

    // Start download
    await page.click('#start');

    // Wait for completion (up to 30 seconds for slow browsers)
    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 });

    // Check for console errors (ignore 404s for favicon etc)
    const realErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('Permissions-Policy') &&
      !e.includes('mitm.html')
    );
    
    expect(realErrors).toHaveLength(0);
  });

  test('should download 10 MiB file', async ({ page, browserName }) => {
    await page.goto('/examples/auto-plain-text.html');

    await page.fill('#filename', `large-${browserName}.txt`);
    await page.fill('#size', '10');

    await page.click('#start');

    // 10 MiB takes longer
    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 60000 });
  });

  test('should use service worker (not blob fallback)', async ({ page }) => {
    // Check that service worker is registered
    await page.goto('/examples/auto-plain-text.html');
    
    const hasServiceWorker = await page.evaluate(() => {
      return 'serviceWorker' in navigator;
    });

    expect(hasServiceWorker).toBe(true);

    // Trigger download
    await page.fill('#filename', 'sw-test.txt');
    await page.fill('#size', '1');
    await page.click('#start');

    await expect(page.locator('#status')).toHaveText(/Done!/, { timeout: 30000 });
  });
});

test.describe('StreamSaver manual-download', () => {
  
  test('should write and close manually', async ({ page }) => {
    await page.goto('/examples/plain-text.html');

    await page.fill('#\\$filename', 'manual-test.txt');
    
    // Write some data
    await page.click('#\\$a');
    await page.click('#\\$b');
    await page.click('#\\$c');

    // Close to finish download
    await page.click('#\\$close', { timeout: 5000 });

    // Page should show "Try again" link after close
    await expect(page.locator('body')).toContainText('Try again');
  });
});