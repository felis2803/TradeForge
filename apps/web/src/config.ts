const DEFAULT_API_BASE = 'http://localhost:3001';

export const API_BASE = import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE;

const defaultWsBase = API_BASE.replace(/^http/i, 'ws');
export const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${defaultWsBase}/ws?role=ui`;
