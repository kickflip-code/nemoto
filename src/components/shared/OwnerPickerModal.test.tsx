import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import OwnerPickerModal from './OwnerPickerModal';

describe('OwnerPickerModal', () => {
    beforeEach(() => {
        usePortfolioStore.setState({
            portfolio: {
                version: '1.0.0',
                lastModified: new Date().toISOString(),
                assets: [
                    { id: 'role-1', name: 'Process Owner', type: 'roles' },
                    { id: 'doc-1', name: 'Operating Manual', type: 'documents' },
                ],
                assetCategories: [
                    { id: 'roles', label: 'Roles', color: 'blue', icon: 'User', baseType: 'role' },
                    { id: 'systems', label: 'Systems', color: 'purple', icon: 'Database', baseType: 'system' },
                    { id: 'documents', label: 'Documents', color: 'gray', icon: 'FileText', baseType: 'document' },
                ],
                processes: [],
                processFolders: [],
                incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
            },
        });
    });

    it('reserves space for the search icon and excludes non-owner resource categories', () => {
        render(<OwnerPickerModal onClose={vi.fn()} onSelect={vi.fn()} />);

        expect(screen.getByRole('searchbox', { name: 'Search owners' })).toHaveClass('nemoto-field-leading-icon');
        expect(screen.getByText('Process Owner')).toBeInTheDocument();
        expect(screen.queryByText('Operating Manual')).not.toBeInTheDocument();
    });

    it('creates a missing resource and selects it as the owner in the same flow', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const onSelect = vi.fn();
        render(<OwnerPickerModal onClose={onClose} onSelect={onSelect} />);

        await user.type(screen.getByRole('searchbox', { name: 'Search owners' }), 'Product Lead');
        expect(screen.getByText('No owners found.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Create new resource/i }));
        expect(screen.getByRole('textbox', { name: 'Resource Name' })).toHaveValue('Product Lead');
        expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('roles');

        await user.click(screen.getByRole('button', { name: 'Create Resource' }));

        const createdResource = usePortfolioStore.getState().portfolio.assets.find(asset => asset.name === 'Product Lead');
        expect(createdResource).toMatchObject({ type: 'roles' });
        expect(onSelect).toHaveBeenCalledWith(createdResource?.id);
        expect(onClose).toHaveBeenCalledOnce();
    });
});
