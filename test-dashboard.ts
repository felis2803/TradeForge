import { createDashboardServer } from '@tradeforge/sdk/dist/dashboard.js';

console.log('Testing dashboard server...');

const server = createDashboardServer({
  enabled: true,
  port: 3000,
  autoOpenBrowser: true,
});

console.log(`Dashboard server created: ${server.url}`);

// Keep running for 30 seconds
setTimeout(async () => {
  console.log('Closing dashboard server...');
  await server.close();
  console.log('Done');
  process.exit(0);
}, 30000);
