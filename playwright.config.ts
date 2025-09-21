import { defineConfig, devices } from '@playwright/test';

const PORT_BACKEND = Number(process.env.BACKEND_PORT ?? 3001);
const PORT_FRONTEND = Number(process.env.FRONTEND_PORT ?? 5173);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT_FRONTEND}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `pnpm --dir apps/svc start`,
      port: PORT_BACKEND,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(PORT_BACKEND),
      },
    },
    {
      command: `pnpm --dir apps/web dev`,
      port: PORT_FRONTEND,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
