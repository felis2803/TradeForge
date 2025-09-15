export function run(args: string[] = process.argv.slice(2)): void {
  if (args.includes('--version')) {
    console.log('TradeForge CLI v0.1.0');
  } else {
    console.log('TradeForge CLI: core-ready');
  }
}

run();
