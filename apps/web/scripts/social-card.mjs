import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Capture the real hero and shared app components, not a separately drawn UI.
// Run the web app first; pass its local URL to capture a production preview.
const url = process.argv[2] ?? "http://localhost:42000";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: `
      body { overflow: hidden; }
      .page-width { width: 1112px; }
      .site-header { min-height: 90px; }
      .site-header nav, .hero-actions, .hero-reassurance, .calendar-note, .product-demo figcaption,
      .how-section, .free-section, .faq-section, .download-section, .site-footer { display: none; }
      .hero { grid-template-columns: 500px 532px; gap: 80px; padding: 0; align-items: start; }
      .hero-copy { padding-top: 70px; }
      .hero-copy h1 { font-size: 57px; }
      .hero-description { font-size: 20px; max-width: 460px; }
      .product-demo { width: 760px; transform: scale(.7); transform-origin: top left; }
    `,
  });
  await page.screenshot({
    path: fileURLToPath(new URL("../public/social-card.png", import.meta.url)),
    animations: "disabled",
  });
} finally {
  await browser.close();
}
