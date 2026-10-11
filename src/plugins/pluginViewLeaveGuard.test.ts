import { expect, it, vi } from 'vitest';
import { hasUnsavedPluginChanges, registerPluginViewLeaveGuard } from './pluginViewLeaveGuard';
import { useUIStore } from '../stores/useUIStore';

it('keeps the current view until explicit discard, and removes only its own guard', () => {
    useUIStore.setState({ activeView: 'org.example.test/view' });
    let dirty = true;
    const requestLeave = vi.fn();
    const remove = registerPluginViewLeaveGuard('org.example.test/view', { hasUnsavedChanges: () => dirty, requestLeave });
    expect(hasUnsavedPluginChanges()).toBe(true);
    useUIStore.getState().setActiveView('designer');
    expect(useUIStore.getState().activeView).toBe('org.example.test/view');
    expect(requestLeave).toHaveBeenCalledTimes(1);
    requestLeave.mock.calls[0][0]();
    expect(useUIStore.getState().activeView).toBe('designer');
    dirty = false;
    expect(hasUnsavedPluginChanges()).toBe(false);
    remove();
    expect(hasUnsavedPluginChanges()).toBe(false);
});
