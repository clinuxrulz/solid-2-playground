import pkg from '@playwright/test';
const { test, expect, chromium, Browser, Page } = pkg;

const SIMPLE_CODE = `import { render } from '@solidjs/web';
import { createSignal } from 'solid-js';

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <button onClick={() => setCount(count() + 1)}>
      Count: {count()}
    </button>
  );
}

render(() => <App />, document.getElementById('root')!);
`;

const IMPORT_MAP_BETA2 = JSON.stringify({
  imports: {
    "solid-js": "https://esm.sh/solid-js@2.0.0-beta.2?dev",
    "@solidjs/web": "https://esm.sh/@solidjs/web@2.0.0-beta.2?dev&external=solid-js"
  }
}, null, 2);

const IMPORT_MAP_BETA4 = JSON.stringify({
  imports: {
    "solid-js": "https://esm.sh/solid-js@2.0.0-beta.4?dev",
    "@solidjs/web": "https://esm.sh/@solidjs/web@2.0.0-beta.4?dev&external=solid-js"
  }
}, null, 2);

test.describe('Solid 2 beta version comparison - Runtime Test', () => {
  let browser: Browser;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
  });

  test('test beta.2 runtime errors in preview', async ({ page }) => {
    const errors: string[] = [];
    const iframeErrors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(`[Console Error] ${msg.text()}`);
      }
    });

    page.on('pageerror', err => {
      errors.push(`[PageError] ${err.message}`);
    });

    console.log('\n=== Loading playground with beta.2 ===');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Set import map to beta.2 first via the import-map.json file
    const importMapTab = page.locator('div').filter({ hasText: /^Import Map$/ }).first();
    if (await importMapTab.isVisible()) {
      await importMapTab.click();
      await page.waitForTimeout(500);
    }

    const editor = page.locator('.cm-editor').first();
    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(IMPORT_MAP_BETA2);
      await page.waitForTimeout(2000);
    }

    // Enter the test code
    const mainTab = page.locator('div').filter({ hasText: /^main\.tsx$/ }).first();
    if (await mainTab.isVisible()) {
      await mainTab.click();
      await page.waitForTimeout(500);
    }

    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(SIMPLE_CODE);
      await page.waitForTimeout(2000);
    }

    // Wait for compilation and preview to update
    console.log('Waiting for compilation and preview...');
    await page.waitForTimeout(10000);

    // Check the preview iframe
    const previewFrame = page.frameLocator('iframe[title="preview"]');
    
    // Listen for errors in the iframe
    await previewFrame.locator('body').waitFor({ timeout: 5000 }).catch(() => {});
    
    // Check if there's an error displayed in the preview
    const errorDiv = previewFrame.locator('.bg-red-500');
    const hasError = await errorDiv.isVisible().catch(() => false);
    
    if (hasError) {
      const errorText = await errorDiv.textContent();
      console.log('\n=== Error in preview (beta.2) ===');
      console.log(errorText);
      iframeErrors.push(errorText || '');
    }

    console.log('\n=== Console errors (beta.2) ===');
    console.log('Count:', errors.length);
    errors.forEach(e => console.log('  ', e));

    // Filter for Solid-specific errors
    const solidErrors = errors.filter(e => 
      e.includes('isDelegated') ||
      e.includes('untrack') ||
      e.includes('Hydration') ||
      e.includes('hydration') ||
      e.includes('registerRoot') ||
      e.includes('createComponent') ||
      e.includes('solid')
    );

    if (solidErrors.length > 0 || iframeErrors.length > 0) {
      console.log('\n=== SOLID-SPECIFIC ERRORS FOUND ===');
      solidErrors.forEach(e => console.log('  Console:', e));
      iframeErrors.forEach(e => console.log('  Iframe:', e));
    } else {
      console.log('\nNo Solid-specific errors found');
    }
  });

  test('test beta.4 runtime errors in preview', async ({ page }) => {
    const errors: string[] = [];
    const iframeErrors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(`[Console Error] ${msg.text()}`);
      }
    });

    page.on('pageerror', err => {
      errors.push(`[PageError] ${err.message}`);
    });

    console.log('\n=== Loading playground with beta.4 ===');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Set import map to beta.4 first via the import-map.json file
    const importMapTab = page.locator('div').filter({ hasText: /^Import Map$/ }).first();
    if (await importMapTab.isVisible()) {
      await importMapTab.click();
      await page.waitForTimeout(500);
    }

    const editor = page.locator('.cm-editor').first();
    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(IMPORT_MAP_BETA4);
      await page.waitForTimeout(2000);
    }

    // Enter the test code
    const mainTab = page.locator('div').filter({ hasText: /^main\.tsx$/ }).first();
    if (await mainTab.isVisible()) {
      await mainTab.click();
      await page.waitForTimeout(500);
    }

    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(SIMPLE_CODE);
      await page.waitForTimeout(2000);
    }

    // Wait for compilation and preview to update
    console.log('Waiting for compilation and preview...');
    await page.waitForTimeout(10000);

    // Check the preview iframe
    const previewFrame = page.frameLocator('iframe[title="preview"]');
    
    // Listen for errors in the iframe
    await previewFrame.locator('body').waitFor({ timeout: 5000 }).catch(() => {});
    
    // Check if there's an error displayed in the preview
    const errorDiv = previewFrame.locator('.bg-red-500');
    const hasError = await errorDiv.isVisible().catch(() => false);
    
    if (hasError) {
      const errorText = await errorDiv.textContent();
      console.log('\n=== Error in preview (beta.4) ===');
      console.log(errorText);
      iframeErrors.push(errorText || '');
    }

    console.log('\n=== Console errors (beta.4) ===');
    console.log('Count:', errors.length);
    errors.forEach(e => console.log('  ', e));

    // Filter for Solid-specific errors
    const solidErrors = errors.filter(e => 
      e.includes('isDelegated') ||
      e.includes('untrack') ||
      e.includes('Hydration') ||
      e.includes('hydration') ||
      e.includes('registerRoot') ||
      e.includes('createComponent') ||
      e.includes('solid')
    );

    if (solidErrors.length > 0 || iframeErrors.length > 0) {
      console.log('\n=== SOLID-SPECIFIC ERRORS FOUND ===');
      solidErrors.forEach(e => console.log('  Console:', e));
      iframeErrors.forEach(e => console.log('  Iframe:', e));
    } else {
      console.log('\nNo Solid-specific errors found');
    }
  });
});
