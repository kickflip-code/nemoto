import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { restoreThemeDocumentAndActivate } from './tauri';

describe('native theme recovery bridge', () => {
  it('uses the transactional restore command with the complete document and replace choice', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const document = {
      schema: 'axiom.theme',
      version: 2,
      id: 'org.example.recovery',
      extensions: { 'org.example.plugin': { retained: true } },
    };

    await restoreThemeDocumentAndActivate(document, true);

    expect(invoke).toHaveBeenCalledWith('restore_theme_and_activate', {
      document,
      replace: true,
    });
  });
});
