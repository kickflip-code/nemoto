import { afterEach, expect, it, vi } from 'vitest';
import { waitForPluginUiSlot } from './pluginUiPacing';

afterEach(() => vi.useRealTimers());
it('shares a bounded pace across instances of one plugin, without delaying another plugin', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
    const completed: number[] = [];
    const calls = Array.from({ length: 21 }, () => waitForPluginUiSlot('pacing-test').then(() => completed.push(performance.now())));
    await waitForPluginUiSlot('independent-test');
    await Promise.resolve();
    expect(completed).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(completed).toHaveLength(10);
    await vi.runAllTimersAsync();
    await Promise.all(calls);
    expect(completed[20]).toBe(2020);
});
