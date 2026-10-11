import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from './AppErrorBoundary';

function BrokenView(): never {
    throw new Error('The test view crashed');
}

describe('AppErrorBoundary', () => {
    it('shows a useful recovery screen instead of a blank window', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const preventExpectedTestError = (event: ErrorEvent) => event.preventDefault();
        window.addEventListener('error', preventExpectedTestError);

        try {
            render(
                <AppErrorBoundary>
                    <BrokenView />
                </AppErrorBoundary>,
            );
        } finally {
            window.removeEventListener('error', preventExpectedTestError);
        }

        expect(screen.getByRole('heading', { name: 'Nemoto hit an unexpected problem' })).toBeInTheDocument();
        expect(screen.getByText('The test view crashed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try reopening the view' })).toBeInTheDocument();
    });
});
