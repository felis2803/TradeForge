const { chromium } = require('playwright');
const path = require('path');

(async () => {
    console.log('🚀 Launching browser...');
    // Launch browser without specific port args to let Playwright manage connection via pipe
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Standard CI/automation args
    });

    try {
        const page = await browser.newPage();

        console.log('🌐 Navigating to dashboard...');
        await page.goto('http://localhost:3000');

        // Wait for the main header to ensure app is loaded
        console.log('⏳ Waiting for content...');
        await page.waitForSelector('h1', { timeout: 10000 });

        // Wait a bit more for WebSocket data to populate
        await page.waitForTimeout(2000);

        const screenshotPath = path.resolve(__dirname, 'dashboard_screenshot.png');
        console.log(`📸 Taking screenshot to: ${screenshotPath}`);

        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('✅ Screenshot captured successfully!');

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
