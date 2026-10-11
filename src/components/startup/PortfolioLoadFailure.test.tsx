import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PortfolioLoadFailure from './PortfolioLoadFailure';

describe('PortfolioLoadFailure', () => {
    it('explains the safe state and exposes retry and recovery actions', () => {
        const onRetry = vi.fn();
        const onRecover = vi.fn();
        render(
            <PortfolioLoadFailure
                error="portfolio.json is corrupt"
                recoveryAvailable
                onRecover={onRecover}
                onRetry={onRetry}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Nemoto could not open your portfolio' })).toBeInTheDocument();
        expect(screen.getByText(/Auto-save is paused/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Manage damaged processes' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore recovery file' }));

        expect(onRetry).toHaveBeenCalledOnce();
        expect(onRecover).toHaveBeenCalledOnce();
    });

    it('hides recovery when no recovery file exists', () => {
        render(
            <PortfolioLoadFailure
                error="Read failed"
                recoveryAvailable={false}
                onRecover={() => undefined}
                onRetry={() => undefined}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Restore recovery file' })).not.toBeInTheDocument();
    });
});
