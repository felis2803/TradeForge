import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const zippedFixtures: Record<string, string> = {
  'trades.jsonl.zip':
    'UEsDBBQAAAAIAPKGL1u1V/BPZwAAAOEAAAAMABwAdHJhZGVzLmpzb25sVVQJAAMHRchoB0XIaHV4CwABBAAAAAAEAAAAAKtWykxRslIyVNJRKijKTE4FsQ2AQM8AJFRYUgkUMNAzBbJLMnOBsoam5uYWxmYWIDUGOkrFmSkgLU6hkUq1XNUQs4xQzTI0QDLIEItBhkgGBbv6+CBMMkY1yQjiEJhZRljMMsJwFABQSwECHgMUAAAACADyhi9btVfwT2cAAADhAAAADAAYAAAAAAABAAAApIEAAAAAdHJhZGVzLmpzb25sVVQFAAMHRchodXgLAAEEAAAAAAQAAAAAUEsFBgAAAAABAAEAUgAAAK0AAAAAAA==',
  'depth.jsonl.zip':
    'UEsDBBQAAAAIAPKGL1vhcvb0RgAAAIgAAAALABwAZGVwdGguanNvbmxVVAkAAwdFyGgHRchodXgLAAEEAAAAAAQAAAAAq1ZyVbIyNDU3tzA2szAAAR2lJCWr6GglQxBHz0BJR8kQSMbG6iglwsQNIeIGeqZA8VqualQzDFHNMISqtUQzAyZuAjYDAFBLAQIeAxQAAAAIAPKGL1vhcvb0RgAAAIgAAAALABgAAAAAAAEAAACkgQAAAABkZXB0aC5qc29ubFVUBQADB0XIaHV4CwABBAAAAAAEAAAAAFBLBQYAAAAAAQABAFEAAACLAAAAAAA=',
};

const cache = new Map<string, string>();

export function materializeFixturePath(path: string): string {
  if (existsSync(path)) {
    return path;
  }
  const key = basename(path);
  const encoded = zippedFixtures[key];
  if (!encoded) {
    return path;
  }
  const cached = cache.get(key);
  if (cached && existsSync(cached)) {
    return cached;
  }
  const dir = mkdtempSync(join(tmpdir(), 'tf-fixture-'));
  const target = join(dir, key);
  writeFileSync(target, Buffer.from(encoded, 'base64'));
  cache.set(key, target);
  return target;
}
