import puppeteer from 'puppeteer-core';

export interface BrowserConfig {
  host?: string;
  port?: number;
}

export async function connectToBrowser(config: BrowserConfig = {}) {
  const host = config.host || 'localhost';
  const port = config.port || 3000;
  const browserWSEndpoint = `ws://${host}:${port}`;

  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint,
    });
    console.log(`[Browser] Connected to ${browserWSEndpoint}`);
    return browser;
  } catch (error) {
    console.error(
      `[Browser] Failed to connect to ${browserWSEndpoint}:`,
      error,
    );
    throw error;
  }
}
