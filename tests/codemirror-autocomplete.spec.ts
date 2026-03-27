import pkg from '@playwright/test';

const { test, expect } = pkg;

test('codemirror shows completion tooltip for solid imports', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('preferred-editor', 'codemirror');
  });

  const consoleMessages: string[] = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

  const editor = page.locator('.cm-editor').first();
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type("import { cre } from 'solid-js';");

  const pos = "import { cre".length;

  const result = await page.evaluate(async ({ pos }) => {
    const editorEl = document.querySelector('.cm-editor');
    const view = (editorEl as any)?.cmView?.view;
    if (!view) return { hasView: false };

    const worker = (window as any).__lastLspWorker;
    let completion: any = null;
    try {
      completion = await worker?.getAutocompletion({
        path: 'main.tsx',
        context: { pos, explicit: false },
      });
    } catch (error) {
      completion = { error: String(error) };
    }

    return {
      hasView: true,
      doc: view.state.doc.toString(),
      completion,
    };
  }, { pos });

  await page.keyboard.press('Control+Space');
  await page.waitForTimeout(1500);

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  const options = page.locator('.cm-completionLabel');
  const tooltipVisible = await tooltip.isVisible().catch(() => false);
  const optionTexts = await options.allTextContents().catch(() => []);

  console.log(JSON.stringify({
    tooltipVisible,
    optionTexts,
    result,
    consoleMessages,
  }, null, 2));

  await expect(tooltip).toBeVisible();
  await expect(options.first()).toBeVisible();
  expect(consoleMessages.some((msg) => msg.includes('CodeMirror plugin crashed'))).toBeFalsy();
});

test('codemirror keeps automatic completion open while typing', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('preferred-editor', 'codemirror');
  });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

  const editor = page.locator('.cm-editor').first();
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type("const value = ");
  await page.keyboard.type('cr', { delay: 120 });
  await page.waitForTimeout(800);
  await page.keyboard.type('e', { delay: 120 });

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await expect(tooltip).toBeVisible();
});
