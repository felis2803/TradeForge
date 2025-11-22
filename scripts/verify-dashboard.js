import { chromium } from '@playwright/test';
import path from 'path';

async function verify() {
    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({
        headless: true
    });

    let page; // Declare in outer scope for error handling

    try {
        const context = await browser.newContext();
        page = await context.newPage();

        // Set extra HTTP headers to bypass cache
        await page.setExtraHTTPHeaders({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
        });

        // Listen for console messages and errors
        page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[Browser Error] ${err.message}`));

        console.log('🌐 Navigating to http://127.0.0.1:3000...');
        await page.goto('http://127.0.0.1:3000', {
            waitUntil: 'networkidle',
            timeout: 15000
        });

        // Wait for dashboard to load
        console.log('⏳ Waiting for dashboard header...');
        await page.waitForSelector('h1', { timeout: 10000 });

        // Verify title
        const title = await page.textContent('h1');
        console.log(`✅ Found title: "${title}"`);

        // Take screenshot of overview
        const overviewScreenshot = path.resolve('dashboard-overview.png');
        await page.screenshot({ path: overviewScreenshot, fullPage: true });
        console.log(`📸 Overview screenshot saved to: ${overviewScreenshot}`);

        // Wait for bot cards to appear
        console.log('⏳ Waiting for bot cards...');
        await page.waitForSelector('.bot-card', { timeout: 5000 });

        const cards = await page.$$('.bot-card');
        console.log(`✅ Found ${cards.length} bot cards`);

        if (cards.length === 0) {
            throw new Error('No bot cards found');
        }

        // Click on the first bot card to go to detail view
        console.log('🖱️ Clicking on first bot card...');
        await cards[0].click();

        // Wait a bit for the detail view to render
        await page.waitForTimeout(2000);

        // Check if we're in detail view
        const detailView = await page.$('.bot-detail');
        if (!detailView) {
            console.error('❌ Bot Detail view not found!');
            // Take screenshot to see what's visible
            await page.screenshot({ path: 'error-no-detail.png', fullPage: true });
            throw new Error('Bot Detail view did not load');
        }

        console.log('✅ Bot Detail view loaded');

        // Wait for the chart container
        console.log('⏳ Waiting for chart container...');
        const chartContainer = await page.waitForSelector('.card.wide-card', { timeout: 5000 });

        if (chartContainer) {
            console.log('✅ Chart container found');

            // Wait a bit more for chart to render
            await page.waitForTimeout(2000);

            // Take screenshot of detail view with chart
            const detailScreenshot = path.resolve('dashboard-detail-with-chart.png');
            await page.screenshot({ path: detailScreenshot, fullPage: true });
            console.log(`📸 Detail view screenshot saved to: ${detailScreenshot}`);
        } else {
            console.warn('⚠️ Chart container not found');
        }

        console.log('✅ Verification complete!');

    } catch (error) {
        console.error('❌ Error:', error);

        // Take error screenshot
        try {
            if (page) {
                const errorScreenshot = path.resolve('dashboard-error.png');
                await page.screenshot({ path: errorScreenshot, fullPage: true });
                console.log(`📸 Error screenshot saved to: ${errorScreenshot}`);
            }
        } catch (screenshotError) {
            console.error('Failed to take error screenshot:', screenshotError);
        }

        process.exit(1);
    } finally {
        await browser.close();
    }
}

verify();
