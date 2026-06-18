/**
 * Screenshot capture.
 *
 * Takes a full-page PNG of the loaded page and writes it to disk under a
 * per-scan artifacts directory. The path goes into the report metadata so
 * the UI (or PDF exporter) can later overlay bounding boxes on top.
 *
 * Why full-page and not viewport?
 *   Govt portals often have long forms or dashboards that scroll well below
 *   the 800px viewport. A viewport-only screenshot would miss most violations.
 *   Full-page captures everything axe-core can see.
 *
 * Why PNG and not JPEG?
 *   PNG is lossless. Compliance reports get printed, archived, and re-shared;
 *   compression artifacts on text or thin borders look unprofessional.
 *
 * @see ./bbox.js — the matching bounding-box computation that pairs with this.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * @typedef {Object} ScreenshotOptions
 * @property {string} artifactsDir - Where to save (defaults to ./artifacts)
 * @property {string} scanId        - Used to namespace this scan's files
 * @property {boolean} [fullPage=true]
 * @property {number}  [timeoutMs=30000]
 */

/**
 * @typedef {Object} ScreenshotResult
 * @property {string} path        - Absolute filesystem path to the PNG
 * @property {number} width       - Image width in CSS pixels
 * @property {number} height      - Image height (full page, may exceed viewport)
 * @property {number} sizeBytes   - File size on disk
 */

/**
 * Capture a screenshot of the current page state.
 *
 * @param {import('playwright').Page} page
 * @param {ScreenshotOptions} options
 * @returns {Promise<ScreenshotResult>}
 *
 * @throws if the artifactsDir can't be created or the screenshot fails.
 *   Callers should treat screenshot failures as non-fatal — i.e. catch this
 *   error and continue the scan, attaching a warning to the result.
 */
export async function captureScreenshot(page, options) {
  if (!options?.scanId) {
    throw new Error('captureScreenshot: scanId is required');
  }

  const artifactsDir = path.resolve(options.artifactsDir ?? './artifacts');
  const scanDir      = path.join(artifactsDir, options.scanId);
  const filePath     = path.join(scanDir, 'screenshot.png');

  // Ensure the per-scan directory exists. recursive:true is idempotent.
  await fs.mkdir(scanDir, { recursive: true });

  // Take the screenshot. First attempt is full-page (stitched multi-tile).
  // Some pages with overflow:hidden or unusual viewport sizing cause Playwright's
  // full-page mode to fail — in that case, wait 2 s and retry with a viewport-only
  // screenshot so we always get *something*.
  let fullPageError;
  try {
    await page.screenshot({
      path:     filePath,
      fullPage: true,
      timeout:  options.timeoutMs ?? 30_000,
      type:     'png',
    });
  } catch (err) {
    fullPageError = err;
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      await page.screenshot({
        path:    filePath,
        fullPage: false,
        timeout:  options.timeoutMs ?? 30_000,
        type:     'png',
      });
    } catch (viewportErr) {
      throw new Error(
        `Full-page screenshot failed (${fullPageError.message}); ` +
        `viewport fallback also failed (${viewportErr.message}).`,
      );
    }
  }

  const stats = await fs.stat(filePath);

  // Read viewport so the UI can scale bounding boxes correctly. After a
  // full-page screenshot, the page may have scrolled — use document size.
  const dimensions = await page.evaluate(() => ({
    width:  Math.max(document.documentElement.scrollWidth, window.innerWidth),
    height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
  }));

  return {
    path:      filePath,
    width:     dimensions.width,
    height:    dimensions.height,
    sizeBytes: stats.size,
  };
}
