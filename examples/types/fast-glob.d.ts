declare module 'fast-glob' {
  export interface FastGlobOptions {
    cwd?: string;
    dot?: boolean;
    onlyFiles?: boolean;
    absolute?: boolean;
  }

  export type Pattern = string | readonly string[];

  export default function fg(
    patterns: Pattern,
    options?: FastGlobOptions,
  ): Promise<string[]>;
}
