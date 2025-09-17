#!/usr/bin/env node
import fg from 'fast-glob';
import { basename, relative, resolve } from 'node:path';
import process from 'node:process';

interface CliOptions {
  kind?: 'trades' | 'depth';
  cwd: string;
  relative?: boolean;
}

function parseArgs(argv: string[]): {
  patterns: string[];
  options: CliOptions;
} {
  const options: CliOptions = { cwd: process.cwd() };
  const patterns: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--kind=')) {
      const value = arg.slice('--kind='.length).toLowerCase();
      if (value === 'trades' || value === 'depth') {
        options.kind = value;
      } else {
        throw new Error(`unknown kind: ${value}`);
      }
      continue;
    }
    if (arg === '--kind') {
      const next = argv[++i];
      if (!next) throw new Error('--kind requires value');
      const value = next.toLowerCase();
      if (value === 'trades' || value === 'depth') {
        options.kind = value;
      } else {
        throw new Error(`unknown kind: ${value}`);
      }
      continue;
    }
    if (arg === '--relative') {
      options.relative = true;
      continue;
    }
    patterns.push(arg);
  }
  if (patterns.length === 0) {
    throw new Error('at least one glob pattern is required');
  }
  return { patterns, options };
}

function printHelp(): void {
  console.log(`Usage: find-files [options] <glob> [glob...]

Options:
  --kind <trades|depth>  Filter files by dataset type.
  --relative            Print paths relative to current working directory.
  -h, --help            Show this help.
`);
}

function matchesKind(file: string, kind?: 'trades' | 'depth'): boolean {
  if (!kind) return true;
  const name = basename(file).toLowerCase();
  if (kind === 'trades') {
    return name.includes('trade');
  }
  return name.includes('depth') || name.includes('book');
}

async function run(): Promise<void> {
  try {
    const { patterns, options } = parseArgs(process.argv.slice(2));
    const files = await fg<string>(patterns, {
      cwd: options.cwd,
      dot: false,
      onlyFiles: true,
      absolute: true,
    })) as string[];
    const filtered = files.filter((file: string) =>
      matchesKind(file, options.kind),
    );
    const sorted = [...new Set(filtered)].sort();
    for (const file of sorted) {
      const output = options.relative
        ? relative(options.cwd, file)
        : resolve(file);
      console.log(output);
    }
    if (sorted.length === 0) {
      console.warn('no files matched the provided patterns');
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(String(err));
    }
    process.exit(1);
  }
}

await run();
