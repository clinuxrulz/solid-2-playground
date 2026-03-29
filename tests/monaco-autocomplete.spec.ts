import pkg from '@playwright/test';

const { test, expect } = pkg;

test('monaco shows only member completions for x.', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('preferred-editor', 'monaco');
  });

  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    consoleLogs.push(msg.text());
  });

  await page.goto('http://localhost:3002', { waitUntil: 'networkidle' });

  await page.waitForTimeout(2000);

  const monacoEditor = page.locator('.monaco-editor').first();
  await expect(monacoEditor).toBeVisible();

  // Type: let x = { a: 1 }; x.
  await monacoEditor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('let x = { a: 1 }; x.');

  // Trigger completion after '.'
  await page.waitForTimeout(500);

  const logs = consoleLogs.filter(l => l.includes('Completions:') || l.includes('Dot completion'));
  console.log('Relevant logs:', logs);
  
  // Get completion result directly
  const completionResult = await page.evaluate(async () => {
    const worker = (window as any).__lastLspWorker;
    if (!worker) return { error: 'no worker' };
    
    // Position after "x."
    const result = await worker.getAutocompletion({
      path: '/main.tsx',
      context: { pos: 19, explicit: false, triggerCharacter: '.' }
    });
    
    return {
      total: result?.options?.length || 0,
      first10: result?.options?.slice(0, 10).map((o: any) => o.label),
    };
  });
  
  console.log('Completion result:', JSON.stringify(completionResult, null, 2));
});
