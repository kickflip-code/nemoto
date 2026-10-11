import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '../../stores/useUIStore';
import EmptyPortfolioWelcome from './EmptyPortfolioWelcome';

describe('EmptyPortfolioWelcome', () => {
    beforeEach(() => {
        useUIStore.setState({
            activeView: 'designer',
            importDialogOpen: false,
            leftPanelOpen: false,
            processCreationOpen: false,
        });
    });

    it('offers clear first steps and explains the core concepts', () => {
        render(<EmptyPortfolioWelcome />);

        expect(screen.getByRole('heading', { name: 'Welcome to Nemoto' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Processes' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Journal' })).toBeInTheDocument();
    });

    it('opens the existing process creation and import flows', () => {
        render(<EmptyPortfolioWelcome />);

        fireEvent.click(screen.getByRole('button', { name: 'Create your first process' }));
        expect(useUIStore.getState()).toMatchObject({
            activeView: 'designer',
            leftPanelOpen: true,
            processCreationOpen: true,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Import existing work' }));
        expect(useUIStore.getState().importDialogOpen).toBe(true);
    });
});
