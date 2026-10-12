import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createThemeConfig } from '../theme/themeFiles';
import { useAutoBackup } from './useAutoBackup';
import { toast } from 'sonner';

const nativeFileMocks = vi.hoisted(() => ({
  writeNemotoFileAtomic: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../lib/tauri', () => ({
  writeNemotoFileAtomic: nativeFileMocks.writeNemotoFileAtomic,
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: nativeFileMocks.readDir,
  remove: nativeFileMocks.remove,
  mkdir: nativeFileMocks.mkdir,
}));
vi.mock('@tauri-apps/api/path', () => ({
  documentDir: vi.fn().mockResolvedValue('C:/Documents'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

const AutoBackupProbe = () => {
  useAutoBackup();
  return null;
};

describe('scheduled Portfolio appearance backup', () => {
  it('creates the resolved Nemoto default directory before writing and retaining snapshots', async () => {
    useSettingsStore.setState({ backupPath: null });
    render(<AutoBackupProbe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(nativeFileMocks.mkdir).toHaveBeenCalledWith('C:/Documents/NemotoBackups', { recursive: true });
    expect(nativeFileMocks.writeNemotoFileAtomic).toHaveBeenCalledWith(
      expect.stringMatching(/^C:\/Documents\/NemotoBackups\/auto-backup-.*\.nemoto$/),
      expect.any(String), false,
    );
    expect(nativeFileMocks.readDir).toHaveBeenCalledWith('C:/Documents/NemotoBackups');
    expect(useSettingsStore.getState().autoBackupStatus?.kind).toBe('saved');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    nativeFileMocks.writeNemotoFileAtomic.mockReset();
    nativeFileMocks.writeNemotoFileAtomic.mockResolvedValue(undefined);
    nativeFileMocks.readDir.mockReset();
    nativeFileMocks.readDir.mockResolvedValue([]);
    nativeFileMocks.remove.mockReset();
    nativeFileMocks.mkdir.mockReset();
    usePortfolioStore.setState({ portfolio: structuredClone(emptyPortfolio), isDirty: false });
    useSettingsStore.setState({
      autoBackupInterval: 1,
      autoBackupRetention: 10,
      backupPath: 'C:/AxiomBackups',
      lastBackupTime: null,
      autoBackupStatus: null,
      theme: 'void',
      activeThemeId: null,
      customThemes: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the same complete active-theme snapshot as a manual full backup', async () => {
    const theme = createThemeConfig('Scheduled Brand', 'polar', 'org.example.scheduled-brand');
    theme.sourceDocument = {
      ...theme.sourceDocument,
      extensions: { 'org.example.publisher': { retained: true } },
      futureCoreField: { retained: true },
    };
    useSettingsStore.setState({ activeThemeId: theme.id, customThemes: [theme] });
    render(<AutoBackupProbe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(nativeFileMocks.writeNemotoFileAtomic).toHaveBeenCalledOnce();
    const [path, content, createBackup] = nativeFileMocks.writeNemotoFileAtomic.mock.calls[0];
    const archive = JSON.parse(content as string);
    expect(path).toMatch(/^C:\/AxiomBackups\/auto-backup-.*\.nemoto$/);
    expect(createBackup).toBe(false);
    expect(archive).toMatchObject({
      format: 'axiom',
      kind: 'portfolio',
      appearance: {
        schema: 'axiom.appearance',
        version: 1,
        activeTheme: {
          kind: 'custom',
          id: theme.id,
          document: {
            id: theme.id,
            extensions: { 'org.example.publisher': { retained: true } },
            futureCoreField: { retained: true },
          },
        },
      },
    });
    expect(useSettingsStore.getState().lastBackupTime).not.toBeNull();
  });

  it('does not report a successful backup when the atomic disk write fails', async () => {
    nativeFileMocks.writeNemotoFileAtomic.mockRejectedValueOnce(new Error('disk full'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AutoBackupProbe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(useSettingsStore.getState().lastBackupTime).toBeNull();
    expect(nativeFileMocks.readDir).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[AutoBackup] Failed to create automatic backup:',
      expect.any(Error),
    );
  });

  it('retains failure status, suppresses repeated notifications, and reports recovery once', async () => {
    const error = vi.spyOn(toast, 'error');
    const success = vi.spyOn(toast, 'success');
    nativeFileMocks.writeNemotoFileAtomic.mockRejectedValue(new Error('disk full'));
    const { unmount } = render(<AutoBackupProbe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(error).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().autoBackupStatus).toMatchObject({
      kind: 'backup-failed', path: 'C:/AxiomBackups', message: 'disk full',
    });
    expect(useSettingsStore.getState().lastBackupTime).toBeNull();
    // Status is device-local and survives persistence rehydration/remount.
    const failedStatus = useSettingsStore.getState().autoBackupStatus;
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().autoBackupStatus).toEqual(failedStatus);
    unmount();
    render(<AutoBackupProbe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(error).toHaveBeenCalledTimes(1);
    nativeFileMocks.writeNemotoFileAtomic.mockResolvedValue(undefined);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(success).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().autoBackupStatus?.kind).toBe('saved');
    expect(useSettingsStore.getState().autoBackupStatus?.message).toBeUndefined();
    expect(useSettingsStore.getState().lastBackupTime).not.toBeNull();
  });

  it('distinguishes retention failure from a failed snapshot and updates the last success', async () => {
    const error = vi.spyOn(toast, 'error');
    const warning = vi.spyOn(toast, 'warning');
    nativeFileMocks.readDir.mockRejectedValue(new Error('Access denied'));
    render(<AutoBackupProbe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().lastBackupTime).not.toBeNull();
    expect(useSettingsStore.getState().autoBackupStatus).toMatchObject({ kind: 'cleanup-failed', message: 'Access denied' });
    nativeFileMocks.readDir.mockResolvedValue([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(useSettingsStore.getState().autoBackupStatus?.kind).toBe('saved');
  });

  it('does not overlap slow backup attempts', async () => {
    let finish!: () => void;
    nativeFileMocks.writeNemotoFileAtomic.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<AutoBackupProbe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(nativeFileMocks.writeNemotoFileAtomic).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(nativeFileMocks.writeNemotoFileAtomic).toHaveBeenCalledTimes(2);
  });
});
