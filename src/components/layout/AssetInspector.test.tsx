import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import AssetInspector from './AssetInspector';

describe('AssetInspector imported properties', () => {
    beforeEach(() => {
        usePortfolioStore.setState(state => ({
            portfolio: {
                ...state.portfolio,
                processes: [],
                assets: [{
                    id: 'asset-imported',
                    name: 'Laptop',
                    type: 'hardware',
                    metadata: { Cost: 249.5, Active: false, Purchased: '2026-08-21' },
                }],
                assetCategories: [{ id: 'hardware', label: 'Hardware', icon: 'Box', color: 'gray' }],
                journal: { notebooks: [], entries: [], tags: [], folders: [] },
            },
        }));
    });

    it('renders typed imported values without hiding booleans', () => {
        render(<AssetInspector id="asset-imported" />);

        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Laptop');
        expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('hardware');
        expect(screen.getByRole('textbox', { name: 'Property key' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Property value (optional)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove property Cost' })).toBeInTheDocument();

        expect(screen.getByText('249.5')).toBeInTheDocument();
        expect(screen.getByText('false')).toBeInTheDocument();
        expect(screen.getByText('2026-08-21')).toBeInTheDocument();
    });
});
