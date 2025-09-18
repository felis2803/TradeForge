import process from 'node:process';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:3000';

function buildUrl(path: string): string {
  return new URL(path, BASE_URL).toString();
}

async function isReachable(): Promise<boolean> {
  try {
    await fetch(buildUrl('/'));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[examples/08-rest-mini] fetch to ${BASE_URL} failed: ${message}`,
    );
    return false;
  }
}

async function createAccount(): Promise<string> {
  const response = await fetch(buildUrl('/v1/accounts'), { method: 'POST' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `failed to create account: status ${response.status} ${response.statusText}. Body: ${text}`,
    );
  }
  let payload: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    throw new Error(
      `unexpected content-type: ${contentType || 'unknown'}, body: ${text}`,
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('account response is not an object');
  }
  const accountId = (payload as Record<string, unknown>)['accountId'];
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new Error('accountId missing in response');
  }
  return accountId;
}

async function main(): Promise<void> {
  const reachable = await isReachable();
  if (!reachable) {
    console.log(
      `[examples/08-rest-mini] svc is not reachable at ${BASE_URL}. Start it with: pnpm --filter @tradeforge/svc dev`,
    );
    return;
  }

  const accountId = await createAccount();
  console.log(`REST_MINI_SMOKE_OK {"accountId":"${accountId}"}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/08-rest-mini] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
