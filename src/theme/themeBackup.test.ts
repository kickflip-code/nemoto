import { describe, expect, it, vi } from 'vitest';
import type { ThemeConfig } from '../types';
import { createThemeConfig, toThemeFile } from './themeFiles';
import {
  APPEARANCE_BACKUP_SCHEMA,
  APPEARANCE_BACKUP_VERSION,
  applyThemeRestorePlan,
  createAppearanceBackup,
  getDefaultThemeRestoreChoice,
  inspectAppearanceBackup,
  type ThemeRestoreActions,
} from './themeBackup';

const envelope = (appearance?: unknown): Record<string, unknown> => ({
  format: 'axiom',
  kind: 'portfolio',
  ...(appearance === undefined ? {} : { appearance }),
  data: {},
});

const customTheme = (label = 'Portable'): ThemeConfig => {
  const theme = createThemeConfig(label, 'polar', 'org.example.portable');
  theme.sourceDocument = {
    ...theme.sourceDocument,
    extensions: { 'org.example.publisher': { preserved: true } },
  };
  return theme;
};

const actions = (): ThemeRestoreActions => ({
  activateBuiltIn: vi.fn().mockResolvedValue(undefined),
  restoreCustom: vi.fn().mockResolvedValue(undefined),
  activateCustom: vi.fn().mockResolvedValue(undefined),
});

describe('appearance backup contract', () => {
  it.each([
    ['void', 'void'],
    ['soft', 'polar'],
    ['hard', 'brutalist'],
  ] as const)('captures built-in runtime %s as portable preset %s', (runtimeId, presetId) => {
    expect(createAppearanceBackup({
      theme: runtimeId,
      activeThemeId: null,
      customThemes: [],
    })).toEqual({
      schema: APPEARANCE_BACKUP_SCHEMA,
      version: APPEARANCE_BACKUP_VERSION,
      activeTheme: { kind: 'built-in', presetId },
    });
  });

  it('embeds the exact active custom theme document without making the portfolio its owner', () => {
    const theme = customTheme();
    const snapshot = createAppearanceBackup({
      theme: 'void',
      activeThemeId: theme.id,
      customThemes: [theme],
    });

    expect(snapshot.activeTheme).toMatchObject({
      kind: 'custom',
      id: theme.id,
      document: {
        schema: 'axiom.theme',
        version: 2,
        id: theme.id,
        extensions: { 'org.example.publisher': { preserved: true } },
      },
    });
  });

  it('fails backup creation rather than silently omitting a missing active custom theme', () => {
    expect(() => createAppearanceBackup({
      theme: 'void',
      activeThemeId: 'org.example.missing',
      customThemes: [],
    })).toThrow('missing from the installed theme library');
  });
});

describe('appearance restore inspection', () => {
  it('keeps old portfolio backups valid when no appearance snapshot exists', async () => {
    await expect(inspectAppearanceBackup(envelope(), [])).resolves.toEqual({ kind: 'none' });
  });

  it('recognizes every portable built-in preset without consulting local files', async () => {
    for (const presetId of ['void', 'polar', 'brutalist'] as const) {
      await expect(inspectAppearanceBackup(envelope({
        schema: APPEARANCE_BACKUP_SCHEMA,
        version: APPEARANCE_BACKUP_VERSION,
        activeTheme: { kind: 'built-in', presetId },
      }), [])).resolves.toEqual({ kind: 'built-in', presetId });
    }
  });

  it('distinguishes a new, matching, and conflicting custom theme', async () => {
    const incoming = customTheme('Backup copy');
    const appearance = createAppearanceBackup({
      theme: 'void',
      activeThemeId: incoming.id,
      customThemes: [incoming],
    });

    await expect(inspectAppearanceBackup(envelope(appearance), []))
      .resolves.toMatchObject({ kind: 'custom-install', incomingTheme: { id: incoming.id } });
    await expect(inspectAppearanceBackup(envelope(appearance), [incoming]))
      .resolves.toMatchObject({ kind: 'custom-match', installedTheme: { id: incoming.id } });

    const local = customTheme('Different local copy');
    await expect(inspectAppearanceBackup(envelope(appearance), [local]))
      .resolves.toMatchObject({
        kind: 'custom-conflict',
        incomingTheme: { label: 'Backup copy' },
        installedTheme: { label: 'Different local copy' },
      });
  });

  it('isolates unsupported, inconsistent, and asset-tampered snapshots from portfolio restore', async () => {
    const theme = customTheme();
    const future = {
      schema: APPEARANCE_BACKUP_SCHEMA,
      version: 2,
      activeTheme: { kind: 'built-in', presetId: 'void' },
    };
    await expect(inspectAppearanceBackup(envelope(future), []))
      .resolves.toMatchObject({ kind: 'invalid', message: expect.stringContaining('version') });

    const mismatched = createAppearanceBackup({
      theme: 'void',
      activeThemeId: theme.id,
      customThemes: [theme],
    });
    if (mismatched.activeTheme.kind !== 'custom') throw new Error('Expected custom theme.');
    mismatched.activeTheme.id = 'org.example.other';
    await expect(inspectAppearanceBackup(envelope(mismatched), []))
      .resolves.toMatchObject({ kind: 'invalid', message: expect.stringContaining('does not match') });

    const tamperedDocument = {
      ...toThemeFile(theme),
      assets: {
        broken: {
          mediaType: 'image/png',
          data: 'aGVsbG8=',
          sha256: '0'.repeat(64),
        },
      },
    };
    await expect(inspectAppearanceBackup(envelope({
      schema: APPEARANCE_BACKUP_SCHEMA,
      version: APPEARANCE_BACKUP_VERSION,
      activeTheme: { kind: 'custom', id: theme.id, document: tamperedDocument },
    }), [])).resolves.toMatchObject({
      kind: 'invalid',
      message: expect.stringMatching(/signature|content/i),
    });
  });
});

describe('appearance restore application', () => {
  it('uses the atomic install-and-activate action for a new custom theme', async () => {
    const theme = customTheme();
    const restoreActions = actions();

    const plan = { kind: 'custom-install', incomingTheme: theme } as const;
    expect(getDefaultThemeRestoreChoice(plan)).toBe('apply');
    await expect(applyThemeRestorePlan(plan, 'apply', restoreActions)).resolves.toMatchObject({
      status: 'applied',
    });
    expect(restoreActions.restoreCustom).toHaveBeenCalledWith(theme, false);
    expect(restoreActions.activateCustom).not.toHaveBeenCalled();
  });

  it('never replaces an ID conflict without the explicit replacement choice', async () => {
    const incomingTheme = customTheme('Backup copy');
    const installedTheme = customTheme('Local copy');
    const plan = { kind: 'custom-conflict', incomingTheme, installedTheme } as const;
    const keepActions = actions();

    expect(getDefaultThemeRestoreChoice(plan)).toBe('keep-installed');
    await applyThemeRestorePlan(plan, 'keep-installed', keepActions);
    expect(keepActions.restoreCustom).not.toHaveBeenCalled();
    expect(keepActions.activateCustom).toHaveBeenCalledWith(installedTheme.id);

    const replaceActions = actions();
    await applyThemeRestorePlan(plan, 'replace-installed', replaceActions);
    expect(replaceActions.restoreCustom).toHaveBeenCalledWith(incomingTheme, true);
    expect(replaceActions.activateCustom).not.toHaveBeenCalled();
  });

  it('keeps the current appearance for absent or invalid snapshots', async () => {
    const restoreActions = actions();
    await expect(applyThemeRestorePlan({ kind: 'none' }, 'skip', restoreActions))
      .resolves.toEqual({ status: 'skipped', message: 'Current appearance kept.' });
    expect(restoreActions.activateBuiltIn).not.toHaveBeenCalled();
    expect(restoreActions.restoreCustom).not.toHaveBeenCalled();
  });
});
