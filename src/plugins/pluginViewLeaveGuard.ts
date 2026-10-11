interface LeaveGuard {
    readonly hasUnsavedChanges: () => boolean;
    readonly requestLeave: (continueNavigation: () => void) => void;
}
const guards = new Map<string, LeaveGuard>();
export function registerPluginViewLeaveGuard(viewId: string, guard: LeaveGuard) {
    guards.set(viewId, guard);
    return () => { if (guards.get(viewId) === guard) guards.delete(viewId); };
}
export function hasUnsavedPluginChanges() {
    return [...guards.values()].some(guard => guard.hasUnsavedChanges());
}
export function leavePluginView(current: string, next: string, navigate: () => void) {
    const guard = guards.get(current);
    if (current !== next && guard?.hasUnsavedChanges()) guard.requestLeave(navigate);
    else navigate();
}
