const { test } = require('playwright/test');

test('inspect map balloon content', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://127.0.0.1:8116/map', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const mapCount = await page.locator('.ymaps-2-1-79-map').count();
  console.log('mapCount', mapCount);
  const map = page.locator('.ymaps-2-1-79-map').first();
  const box = await map.boundingBox();
  console.log('mapBox', box);
  if (!box) return;

  const points = [
    { x: box.x + box.width * 0.55, y: box.y + box.height * 0.65 },
    { x: box.x + box.width * 0.48, y: box.y + box.height * 0.55 },
    { x: box.x + box.width * 0.62, y: box.y + box.height * 0.72 },
  ];

  for (const p of points) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(1200);
    const texts = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[class*="balloon"], [class*="hint"], [class*="cluster"]'));
      return nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25);
    });
    console.log('clickText', JSON.stringify(texts));
  }

  await page.screenshot({ path: '/tmp/map-click-check.png', fullPage: true });
});
