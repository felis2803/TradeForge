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

        // Use host.docker.internal to access the host machine from the container
        // But wait, the browser is in the container, so it needs to reach the dashboard on the host.
        // Docker Desktop for Windows supports host.docker.internal.
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

capture();
