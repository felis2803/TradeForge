import {
  createAcceleratedClock,
  createLogicalClock,
  createWallClock,
} from '../src/index';

describe('SimClock implementations', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('logical clock resolves without scheduling delays', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const clock = createLogicalClock();
    expect(clock.desc()).toBe('logical');
    const promise = clock.tickUntil(5_000);
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0);
    await expect(promise).resolves.toBeUndefined();
  });

  it('wall clock waits until target wall time', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const clock = createWallClock();
    expect(clock.desc()).toBe('wall');
    let resolved = false;
    const wait = clock.tickUntil(10_600).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(599);
    await Promise.resolve();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(1);
    await wait;
    expect(resolved).toBe(true);
  });

  it('accelerated clock shortens wait duration', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(50_000);
    const clock = createAcceleratedClock(10);
    expect(clock.desc()).toBe('accel(x10)');
    let resolved = false;
    const wait = clock.tickUntil(51_000).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(99);
    await Promise.resolve();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(1);
    await wait;
    expect(resolved).toBe(true);
  });
});
