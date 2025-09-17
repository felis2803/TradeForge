import { createReplayController } from '../src/index';

describe('replay controller', () => {
  it('pauses on start and resumes on demand', async () => {
    const controller = createReplayController();
    expect(controller.isPaused()).toBe(false);

    controller.pause();
    expect(controller.isPaused()).toBe(true);

    let resolved = false;
    const waitPromise = controller.waitUntilResumed().then(() => {
      resolved = true;
    });

    controller.resume();
    await waitPromise;

    expect(controller.isPaused()).toBe(false);
    expect(resolved).toBe(true);
  });

  it('ignores duplicate pause and resume calls', async () => {
    const controller = createReplayController();

    controller.pause();
    controller.pause();
    expect(controller.isPaused()).toBe(true);

    const firstWait = controller.waitUntilResumed();
    controller.resume();
    controller.resume();
    await expect(firstWait).resolves.toBeUndefined();
    expect(controller.isPaused()).toBe(false);

    controller.resume();
    expect(controller.isPaused()).toBe(false);
    await expect(controller.waitUntilResumed()).resolves.toBeUndefined();
  });

  it('supports multiple pause/resume cycles', async () => {
    const controller = createReplayController();

    controller.pause();
    const firstWait = controller.waitUntilResumed();
    controller.resume();
    await firstWait;
    expect(controller.isPaused()).toBe(false);

    controller.pause();
    expect(controller.isPaused()).toBe(true);
    const secondWait = controller.waitUntilResumed();
    controller.resume();
    await secondWait;
    expect(controller.isPaused()).toBe(false);
  });
});
