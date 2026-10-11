import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '../../stores/useUIStore';
import AppRail from './AppRail';

describe('AppRail Help entry', () => {
    beforeEach(() => {
        useUIStore.setState({ helpOpen: false });
    });

    it('opens Help from the permanent app rail entry', () => {
        render(<AppRail />);

        const help = screen.getByRole('button', { name: 'Help' });
        expect(help).toHaveAttribute('aria-keyshortcuts', 'F1');
        fireEvent.click(help);

        expect(useUIStore.getState().helpOpen).toBe(true);
    });
});
