import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import CloseGuard from './CloseGuard';
import { registerPluginViewLeaveGuard } from '../../plugins/pluginViewLeaveGuard';

const windowMock = vi.hoisted(() => ({
    destroy: vi.fn().mockResolvedValue(undefined),
    closeHandler: null as null | ((event: { preventDefault: () => void }) => void),
    onCloseRequested: vi.fn(),
    unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        destroy: windowMock.destroy,
        onCloseRequested: windowMock.onCloseRequested,
    }),
}));

describe('CloseGuard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        windowMock.destroy.mockResolvedValue(undefined);
        windowMock.closeHandler = null;
        windowMock.onCloseRequested.mockImplementation(async (handler) => {
            windowMock.closeHandler = handler;
            return windowMock.unlisten;
        });
        usePortfolioStore.setState({
            isDirty: true,
            isSaving: false,
            isRestoring: false,
            saveError: null,
            savePortfolio: vi.fn().mockResolvedValue(undefined),
        });
    });

    const requestClose = async () => {
        const preventDefault = vi.fn();
        await waitFor(() => expect(windowMock.closeHandler).not.toBeNull());
        act(() => windowMock.closeHandler?.({ preventDefault }));
        expect(preventDefault).toHaveBeenCalledOnce();
        return preventDefault;
    };

    it('asks what to do when the native window closes with unsaved changes', async () => {
        render(<CloseGuard />);

        await requestClose();

        expect(screen.getByRole('dialog', { name: 'Save changes before closing?' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save and close' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close without saving' })).toBeInTheDocument();
    });

    it('does not mistake a clean Portfolio for a saved plugin draft', async () => {
        usePortfolioStore.setState({ isDirty: false });
        const unregister = registerPluginViewLeaveGuard('test/view', { hasUnsavedChanges: () => true, requestLeave: vi.fn() });
        try {
            render(<CloseGuard />);
            await requestClose();
            expect(windowMock.destroy).not.toHaveBeenCalled();
            expect(screen.getByRole('dialog', { name: 'Unsaved plugin changes' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Close Nemoto' })).toBeDisabled();
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            expect(windowMock.destroy).not.toHaveBeenCalled();
        } finally { unregister(); }
    });

    it('does not close a clean Portfolio while restore is in progress', async () => {
        usePortfolioStore.setState({ isDirty: false, isRestoring: true });
        render(<CloseGuard />);
        await requestClose();
        expect(windowMock.destroy).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        usePortfolioStore.setState({ isRestoring: false });
        await requestClose();
        expect(windowMock.destroy).toHaveBeenCalledOnce();
    });

    it('finishes a clean native close request without reopening the close guard', async () => {
        usePortfolioStore.setState({ isDirty: false });
        render(<CloseGuard />);

        await requestClose();

        await waitFor(() => expect(windowMock.destroy).toHaveBeenCalledOnce());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes definitively when the user accepts losing unsaved changes', async () => {
        render(<CloseGuard />);
        await requestClose();

        fireEvent.click(screen.getByRole('button', { name: 'Close without saving' }));

        await waitFor(() => expect(windowMock.destroy).toHaveBeenCalledOnce());
    });

    it('saves successfully before allowing the close request through', async () => {
        const savePortfolio = vi.fn().mockImplementation(async () => {
            usePortfolioStore.setState({ isDirty: false, saveError: null });
        });
        usePortfolioStore.setState({ savePortfolio });
        render(<CloseGuard />);
        await requestClose();

        fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));

        await waitFor(() => expect(windowMock.destroy).toHaveBeenCalledOnce());
        expect(savePortfolio).toHaveBeenCalledOnce();
    });

    it('keeps the window open when saving fails', async () => {
        const savePortfolio = vi.fn().mockImplementation(async () => {
            usePortfolioStore.setState({ isDirty: true, saveError: 'The disk is full' });
        });
        usePortfolioStore.setState({ savePortfolio });
        render(<CloseGuard />);
        await requestClose();

        fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('The disk is full');
        expect(windowMock.destroy).not.toHaveBeenCalled();
    });
});
