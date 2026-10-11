import { StateCreator, StoreMutatorIdentifier } from 'zustand';
import type { PortfolioState } from '../usePortfolioStore';

type DirtyTracking = <
    T extends Pick<PortfolioState, 'portfolio' | 'isDirty' | 'isLoading' | 'changeRevision'>,
    Mps extends [StoreMutatorIdentifier, unknown][] = [],
    Mcs extends [StoreMutatorIdentifier, unknown][] = []
>(
    f: StateCreator<T, Mps, Mcs>
) => StateCreator<T, Mps, Mcs>;

type DirtyTrackingImpl = <T extends Pick<PortfolioState, 'portfolio' | 'isDirty' | 'isLoading' | 'changeRevision'>>(
    f: StateCreator<T, [], []>
) => StateCreator<T, [], []>;

const dirtyTrackingImpl: DirtyTrackingImpl = (f) => (set, get, store) => {
    const loggedSet: typeof set = (...a) => {
        const prevState = get();
        // @ts-ignore
        set(...a);
        const nextState = get();

        // Every persisted portfolio change advances the revision. Loading is the
        // sole clean replacement path and is explicitly excluded.
        if (prevState.portfolio !== nextState.portfolio && !prevState.isLoading) {
            // @ts-ignore
            set({
                isDirty: true,
                changeRevision: nextState.changeRevision + 1,
            });
        }
    }

    return f(loggedSet, get, store);
};

export const withDirtyTracking = dirtyTrackingImpl as unknown as DirtyTracking;
