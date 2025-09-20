export * from './types.js';
export { EngineImpl } from './engine.js';
export { ConservativeGate } from './conservative-gate.js';
export { LiquidityPlanner } from './liquidity-planner.js';
export type { PlannedLevel, PlanResult } from './liquidity-planner.js';
export { FillGenerator } from './fill-generator.js';
export { OrderStore } from './order-store.js';

import type { EngineOptions, Engine } from './types.js';
import { EngineImpl } from './engine.js';

export function createEngine(options: EngineOptions): Engine {
  return new EngineImpl(options);
}
