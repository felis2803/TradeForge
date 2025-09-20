import { ARCHIVE_DEFINITIONS, DEFAULT_BASE_URL } from '../constants.js';
import type { ArchiveKind } from '../constants.js';

export function buildArchiveUrl(
  kind: ArchiveKind,
  symbol: string,
  date: string,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  const def = ARCHIVE_DEFINITIONS[kind];
  const path = def.template
    .replaceAll('{symbol}', symbol)
    .replaceAll('{date}', date);
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  return `${base}/${path}`;
}
