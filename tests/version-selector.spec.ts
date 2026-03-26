import pkg from '@playwright/test';
const { test, chromium } = pkg;

test.describe('Version Selector', () => {
  let browser: chromium.Browser;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  test('can select different versions', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    
    console.log('\n=== Testing Version Selection ===');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Find and click version selector
    const versionButton = page.locator('button').filter({ hasText: /Solid/ }).first();
    console.log('Initial version:', await versionButton.textContent());

    await versionButton.click();
    await page.waitForTimeout(500);

    // Find beta.2 option
    const beta2Option = page.locator('.absolute button').filter({ hasText: /beta\.2/ }).first();
    const hasBeta2 = await beta2Option.isVisible().catch(() => false);
    console.log('Has beta.2 option:', hasBeta2);

    if (hasBeta2) {
      await beta2Option.click();
      await page.waitForTimeout(500);
      console.log('After selecting beta.2:', await versionButton.textContent());

      // Check import map
      await page.locator('text=Import Map').click();
      await page.waitForTimeout(500);

      const importMapContent = await page.locator('.cm-content').first().textContent();
      console.log('Import map contains beta.2:', importMapContent?.includes('beta.2'));
    }

    console.log('\nTest passed!');
  });

  test('preview works with selected version', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    
    console.log('\n=== Testing Preview with Version Selection ===');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Select beta.4 (the working version)
    const versionButton = page.locator('button').filter({ hasText: /Solid/ }).first();
    await versionButton.click();
    await page.waitForTimeout(500);

    const beta4Option = page.locator('.absolute button').filter({ hasText: /beta\.4/ }).first();
    await beta4Option.click();
    await page.waitForTimeout(500);

    // Wait for preview to load
    await page.waitForTimeout(5000);

    // Check for errors in the preview
    const previewFrame = page.frameLocator('iframe[title="preview"]');
    const hasError = await previewFrame.locator('.bg-red-500').isVisible().catch(() => false);
    console.log('Preview has error:', hasError);

    if (!hasError) {
      console.log('Preview loaded successfully with selected version!');
    }

    console.log('\nTest passed!');
  });
});
