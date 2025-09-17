declare module 'fast-glob' {
  export interface FastGlobOptions {
    cwd?: string;
    dot?: boolean;
    onlyFiles?: boolean;
    absolute?: boolean;
  }

  export default function fg(
    patterns: string | readonly string[],
    options?: FastGlobOptions,
  ): Promise<string[]>;

  export function sync(
    patterns: string | readonly string[],
    options?: FastGlobOptions,
  ): string[];
}
