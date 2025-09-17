declare module 'fast-glob' {
  type FastGlobOptions = {
    cwd?: string;
    dot?: boolean;
    onlyFiles?: boolean;
    absolute?: boolean;
  };

  function fastGlob<T extends string | Buffer = string>(
    patterns: string | readonly string[],
    options?: FastGlobOptions,
  ): Promise<T[]>;

  export default fastGlob;
}
