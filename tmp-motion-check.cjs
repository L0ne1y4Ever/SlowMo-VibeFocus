const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function main() {
  const consoleMessages = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleMessages.push(`[pageerror] ${err.message}`);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const canvas = page.locator('canvas').first();
  const liveA = await canvas.evaluate((el) => el.toDataURL());
  await page.waitForTimeout(1200);
  const liveB = await canvas.evaluate((el) => el.toDataURL());

  await page.keyboard.press('5');
  await page.waitForTimeout(600);
  const debugA = await canvas.evaluate((el) => el.toDataURL());
  await page.waitForTimeout(1200);
  const debugB = await canvas.evaluate((el) => el.toDataURL());

  const result = {
    liveSame: sha(liveA) === sha(liveB),
    debugSame: sha(debugA) === sha(debugB),
    liveHashA: sha(liveA),
    liveHashB: sha(liveB),
    debugHashA: sha(debugA),
    debugHashB: sha(debugB),
    consoleMessages,
  };

  fs.writeFileSync('tmp-motion-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
