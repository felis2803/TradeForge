import { connectToBrowser } from '../src/browser.js';

async function main() {
  console.log('Testing connection to Dockerized Chrome...');

  try {
    const browser = await connectToBrowser({ port: 3000 });
    const page = await browser.newPage();

    console.log('Navigating to example.com...');
    await page.goto('https://example.com');

    const title = await page.title();
    console.log(`Page title: ${title}`);

    if (title === 'Example Domain') {
      console.log('SUCCESS: Connected to Chrome and retrieved page title.');
    } else {
      console.error('FAILURE: Unexpected page title.');
    }

    await browser.close();
  } catch (error) {
    console.error('FAILURE: Could not connect or interact with Chrome.', error);
    process.exit(1);
  }
}

main();
