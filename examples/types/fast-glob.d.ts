declare module 'fast-glob' {
  type FastGlobOptions = {
    cwd?: string;
    dot?: boolean;
    onlyFiles?: boolean;
    absolute?: boolean;
  };

  export default function fg(
    patterns: string | readonly string[],
    options?: FastGlobOptions,
  ): Promise<string[]>;

  export function sync(
    patterns: string | readonly string[],
    options?: FastGlobOptions,
  ): string[];

  function fastGlob<T extends string | Buffer = string>(
    patterns: string | readonly string[],
    options?: FastGlobOptions,
  ): Promise<T[]>;

  export default fastGlob;
}
