const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    console.log('Connecting to browserless/chrome on port 3001...');
    let browser;
    try {
        browser = await chromium.connectOverCDP('ws://localhost:3001');
        console.log('Connected!');

        const context = browser.contexts()[0] || await browser.newContext();
        const page = await context.newPage();

        // Capture console logs
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[PriceChart]') || text.includes('orders')) {
                console.log(`[BROWSER CONSOLE] ${msg.type()}: ${text}`);
            }
        });

        // Use host.docker.internal to access the host machine from the container
        const url = 'http://host.docker.internal:3000';

        console.log(`Navigating to ${url}...`);
        await page.goto(url);

        console.log('Waiting for dashboard to load...');
        // Wait for a key element that signifies the dashboard is ready
        try {
            await page.waitForSelector('.card', { state: 'visible', timeout: 30000 });
            console.log('Dashboard loaded successfully!');
        } catch (e) {
            console.log('Timeout waiting for .card, taking screenshot anyway...');
        }

        // Give it a moment for charts to render completely
        await page.waitForTimeout(5000);

        const screenshotPath = path.resolve(__dirname, '../dashboard_capture.png');
        console.log(`Taking screenshot to ${screenshotPath}...`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        console.log('Done!');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

capture();
