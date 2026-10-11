import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createThemeConfig } from '../../theme/themeFiles';
import PortfolioRestoreDialog from './PortfolioRestoreDialog';

describe('PortfolioRestoreDialog', () => {
  it('keeps progress open and freezes the theme choice while restoring', () => {
    const onClose = vi.fn();
    const { container } = render(<PortfolioRestoreDialog
      restore={{ name: 'backup.axiom', sourceSchemaVersion: 5,
        themePlan: { kind: 'built-in', presetId: 'void' }, themeChoice: 'apply' }}
      isRestoring onClose={onClose} onConfirm={vi.fn()} onThemeChoiceChange={vi.fn()}
    />);
    expect(container).not.toContainElement(screen.getByRole('dialog'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!.querySelector('.axiom-dialog-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Theme handling' })).toBeDisabled();
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();
  });
  it('requires a visible choice before a conflicting installed theme may be replaced', async () => {
    const user = userEvent.setup();
    const onThemeChoiceChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <PortfolioRestoreDialog
        restore={{
          name: 'portable.axiom',
          sourceSchemaVersion: 5,
          sourceAppVersion: '0.14.0',
          sourceTimestamp: '2026-09-05T06:00:00.000Z',
          themePlan: {
            kind: 'custom-conflict',
            installedTheme: createThemeConfig('Local Brand', 'void', 'org.example.brand'),
            incomingTheme: createThemeConfig('Backup Brand', 'polar', 'org.example.brand'),
          },
          themeChoice: 'keep-installed',
        }}
        isRestoring={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        onThemeChoiceChange={onThemeChoiceChange}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Restore portfolio?' })).toBeInTheDocument();
    expect(screen.getByText(/already exists, but its local and backup contents differ/i)).toBeInTheDocument();
    const choice = screen.getByRole('combobox', { name: 'Theme handling' });
    expect(choice).toHaveValue('keep-installed');

    await user.selectOptions(choice, 'replace-installed');
    expect(onThemeChoiceChange).toHaveBeenCalledWith('replace-installed');

    await user.click(screen.getByRole('button', { name: /^Restore$/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('keeps Portfolio restore available when the optional appearance snapshot is invalid', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <PortfolioRestoreDialog
        restore={{
          name: 'data-only.axiom',
          sourceSchemaVersion: 5,
          themePlan: { kind: 'invalid', message: 'Unsupported appearance snapshot version: 9.' },
          themeChoice: 'skip',
        }}
        isRestoring={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        onThemeChoiceChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Included appearance cannot be restored')).toBeInTheDocument();
    expect(screen.getByText(/Portfolio data can still be restored/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Theme handling' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Restore$/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
