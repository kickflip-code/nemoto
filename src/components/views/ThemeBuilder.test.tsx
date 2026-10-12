import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createThemeConfig, toThemeFile } from '../../theme/themeFiles';
import { ALL_THEME_VARIABLE_NAMES, type ThemeEmbeddedAsset } from '../../theme/themeContract';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { createThemeExportSource, ThemeBuilder } from './ThemeBuilder';

const tauriMocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: tauriMocks.isTauri }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: tauriMocks.getCurrentWindow }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../canvas/CanvasThemePreview', () => ({
  CanvasThemePreview: () => <div data-testid="canvas-theme-preview" />,
}));
vi.mock('./theme-studio/ThemePreviewScenes', () => ({
  ApplicationThemePreview: () => <div data-testid="application-theme-preview" />,
  DialogThemePreview: () => <div data-testid="dialog-theme-preview" />,
  JournalThemePreview: () => <div data-testid="journal-theme-preview" />,
}));

describe('Theme Studio draft export', () => {
  it('exports the visible unsaved name, baseline and tokens while preserving hidden fields', () => {
    const selected = createThemeConfig('Saved name', 'void', 'org.example.draft');
    selected.sourceDocument = {
      ...selected.sourceDocument,
      extensions: { 'org.example.plugin': { kept: true } },
      futureRootField: { kept: true },
    };
    const draftTokens = {
      ...selected.colors,
      '--color-app-bg': '#abcdef',
    };

    const exported = toThemeFile(createThemeExportSource(
      selected,
      'Unsaved visible name',
      draftTokens,
      'polar',
    ));

    expect(exported.label).toBe('Unsaved visible name');
    expect(exported.basePresetId).toBe('polar');
    expect(exported.tokens['--color-app-bg']).toBe('#abcdef');
    expect(exported.extensions).toEqual({ 'org.example.plugin': { kept: true } });
    expect(exported.futureRootField).toEqual({ kept: true });
  });

  it('includes white-label fields from the visible draft without dropping hidden source fields', () => {
    const selected = createThemeConfig('Brand', 'void', 'org.example.brand-draft');
    const logo: ThemeEmbeddedAsset = {
      mediaType: 'image/png',
      data: 'iVBORw0KGgo=',
      sha256: '0'.repeat(64),
    };
    selected.sourceDocument = {
      ...selected.sourceDocument,
      recipes: { futureRecipe: { kept: true } },
    };

    const exported = toThemeFile(createThemeExportSource(
      selected,
      selected.label,
      selected.colors,
      'void',
      {
        brand: { displayName: 'Example Co', logoAssetId: 'brand-logo' },
        typography: {},
        assets: { 'brand-logo': logo },
        recipes: { density: 'compact', surfaceStyle: 'translucent', nodeStyle: 'graphic' },
      },
    ));

    expect(exported.brand).toMatchObject({ displayName: 'Example Co', logoAssetId: 'brand-logo' });
    expect(exported.assets).toEqual({ 'brand-logo': logo });
    expect(exported.recipes).toEqual({
      futureRecipe: { kept: true },
      density: 'compact',
      surfaceStyle: 'translucent',
      nodeStyle: 'graphic',
    });
  });
});

describe('Theme Studio interaction shell', () => {
  const firstTheme = createThemeConfig('First Theme', 'void', 'org.example.first');
  const secondTheme = createThemeConfig('Second Theme', 'polar', 'org.example.second');
  const restoreAndActivateCustomTheme = vi.fn(async () => undefined);

  beforeEach(() => {
    tauriMocks.isTauri.mockReturnValue(false);
    tauriMocks.getCurrentWindow.mockReset();
    useSettingsStore.setState({
      theme: 'void',
      customThemes: [firstTheme, secondTheme],
      activeThemeId: firstTheme.id,
      themesInitialized: true,
      themeLibraryErrors: [],
      installCustomTheme: vi.fn(async () => undefined),
      updateCustomTheme: vi.fn(async () => undefined),
      restoreAndActivateCustomTheme,
      deleteCustomTheme: vi.fn(async () => undefined),
      activateCustomTheme: vi.fn(async () => undefined),
    });
  });

  it('lets the preview reclaim space by hiding and restoring both side panels', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    const layout = screen.getByTestId('theme-studio-layout');
    expect(layout).toHaveAttribute('data-elements-panel', 'open');
    expect(layout).toHaveAttribute('data-inspector-panel', 'open');

    await user.click(screen.getByRole('button', { name: 'Hide elements panel' }));
    expect(layout).toHaveAttribute('data-elements-panel', 'closed');
    expect(screen.queryByTestId('theme-studio-elements-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide properties panel' }));
    expect(layout).toHaveAttribute('data-inspector-panel', 'closed');
    expect(screen.queryByTestId('theme-studio-inspector-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show elements panel' }));
    await user.click(screen.getByRole('button', { name: 'Show properties panel' }));
    expect(screen.getByTestId('theme-studio-elements-panel')).toBeInTheDocument();
    expect(screen.getByTestId('theme-studio-inspector-panel')).toBeInTheDocument();
  });

  it('lets users preview every built-in baseline without creating a theme', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    const themePicker = await screen.findByRole('button', { name: 'Theme to preview or edit' });
    await user.click(themePicker);
    const themeMenu = screen.getByRole('menu', { name: 'Themes to preview or edit' });
    expect(themeMenu).toHaveClass('nemoto-scroll-menu');
    expect(within(themeMenu).getByRole('menuitemradio', { name: /Void baseline/ })).toBeInTheDocument();
    expect(within(themeMenu).getByRole('menuitemradio', { name: /Polar baseline/ })).toBeInTheDocument();
    expect(within(themeMenu).getByRole('menuitemradio', { name: /Brutalist baseline/ })).toBeInTheDocument();

    await user.click(within(themeMenu).getByRole('menuitemradio', { name: /Polar baseline/ }));
    await waitFor(() => expect(themePicker).toHaveTextContent('Polar baseline'));
    expect(screen.getByTestId('theme-studio-preview-frame').firstElementChild).toHaveAttribute('data-theme', 'soft');
    expect(screen.queryByRole('textbox', { name: 'Theme Name' })).not.toBeInTheDocument();
  });

  it('uses the draft baseline art direction immediately when resetting a custom theme', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    expect(screen.getByTestId('theme-studio-preview-frame').firstElementChild).toHaveAttribute('data-theme', 'void');
    await user.click(screen.getByRole('button', { name: /^Polar$/ }));

    expect(screen.getByTestId('theme-studio-preview-frame').firstElementChild).toHaveAttribute('data-theme', 'soft');
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('exposes every public theme token somewhere in the element inspector', async () => {
    const user = userEvent.setup();
    const { container } = render(<ThemeBuilder />);
    await screen.findByRole('textbox', { name: 'Theme Name' });
    const seen = new Set<string>();

    for (const elementName of [
      'Color & Shape',
      'Frame & Navigation',
      'Side Panels',
      'Controls',
      'Dialogs',
      'Journal',
      'Canvas Nodes',
    ]) {
      await user.click(screen.getByRole('button', { name: elementName }));
      container.querySelectorAll<HTMLElement>('[data-theme-token]').forEach(element => {
        const token = element.dataset.themeToken;
        if (token) seen.add(token);
      });
    }

    expect([...seen].sort()).toEqual([...ALL_THEME_VARIABLE_NAMES].sort());
  });

  it('previews Core-owned surface and node recipes without accepting CSS', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: 'Visual Recipes' }));
    expect(screen.getByText('6 Core recipes')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Surface Treatment'), 'translucent');
    await user.selectOptions(screen.getByLabelText('Node Treatment'), 'graphic');

    const previewRoot = screen.getByTestId('theme-studio-preview-frame').firstElementChild;
    expect(previewRoot).toHaveAttribute('data-theme-surface-style', 'translucent');
    expect(previewRoot).toHaveAttribute('data-theme-node-style', 'graphic');
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('resets one token to its current baseline without touching the rest of the draft', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: 'Color & Shape' }));
    const appBackground = screen.getByRole('textbox', { name: 'App Background value' });
    const surface = screen.getByRole('textbox', { name: 'Surface value' });
    const originalSurface = (surface as HTMLInputElement).value;

    await user.clear(appBackground);
    await user.type(appBackground, '#123456');
    await user.click(screen.getByRole('button', { name: 'Reset App Background to baseline' }));

    expect(appBackground).toHaveValue('#050505');
    expect(surface).toHaveValue(originalSurface);
  });

  it('guards theme switching while the visible draft has unsaved changes', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    const nameInput = await screen.findByRole('textbox', { name: 'Theme Name' });
    const themePicker = screen.getByRole('button', { name: 'Theme to preview or edit' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Changed Draft');

    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.click(themePicker);
    await user.click(screen.getByRole('menuitemradio', { name: 'Second Theme' }));

    expect(screen.getByRole('dialog', { name: 'Discard Unsaved Changes?' })).toBeInTheDocument();
    expect(themePicker).toHaveTextContent('First Theme');
    await user.click(screen.getByRole('button', { name: 'Keep Editing' }));
    expect(nameInput).toHaveValue('Changed Draft');

    await user.click(themePicker);
    await user.click(screen.getByRole('menuitemradio', { name: 'Second Theme' }));
    await user.click(screen.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() => expect(themePicker).toHaveTextContent('Second Theme'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Theme Name' })).toHaveValue('Second Theme'));
  });

  it('does not jump back to the active theme after saving or reloading another selection', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    const themePicker = screen.getByRole('button', { name: 'Theme to preview or edit' });
    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(themePicker);
    await user.click(screen.getByRole('menuitemradio', { name: 'Second Theme' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Theme Name' })).toHaveValue('Second Theme'));

    useSettingsStore.setState({
      customThemes: [
        { ...firstTheme },
        { ...secondTheme, label: 'Second Theme Reloaded' },
      ],
    });

    await waitFor(() => expect(themePicker).toHaveTextContent('Second Theme Reloaded'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Theme Name' })).toHaveValue('Second Theme Reloaded'));
  });

  it('blocks page unload only while the draft is dirty', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    const nameInput = await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Unsaved Draft');

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it('intercepts native window close while dirty and closes only after confirmation', async () => {
    const user = userEvent.setup();
    let closeHandler: ((event: { preventDefault: () => void }) => void) | undefined;
    const close = vi.fn(async () => undefined);
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.getCurrentWindow.mockReturnValue({
      close,
      onCloseRequested: vi.fn(async (handler: typeof closeHandler) => {
        closeHandler = handler;
        return vi.fn();
      }),
    });
    render(<ThemeBuilder />);

    const nameInput = await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Unsaved Native Draft');
    const preventDefault = vi.fn();
    act(() => closeHandler?.({ preventDefault }));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'Close Without Saving?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close Without Saving' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('exposes labels for editable token values, color pickers, and sliders', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: 'Color & Shape' }));

    const colorPicker = screen.getByLabelText('App Background color picker');
    expect(colorPicker).toBeInTheDocument();
    expect(colorPicker.closest('label')).toHaveClass('theme-studio-color-picker');
    expect(screen.getByRole('textbox', { name: 'App Background value' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Small Radius slider' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Small Radius value' })).toBeInTheDocument();
  });

  it('requires an explicit choice before replacing an imported stable-ID conflict', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    const importDialog = screen.getByRole('dialog', { name: 'Import Theme File' });
    const jsonInput = within(importDialog).getByRole('textbox', { name: 'Theme JSON' });
    await user.click(jsonInput);
    await user.paste(JSON.stringify(toThemeFile(firstTheme)));
    await user.click(within(importDialog).getByRole('button', { name: 'Import' }));

    const conflictDialog = await screen.findByRole('dialog', { name: 'Replace Installed Theme?' });
    expect(conflictDialog).toHaveTextContent(firstTheme.id);
    expect(restoreAndActivateCustomTheme).not.toHaveBeenCalled();

    await user.click(within(conflictDialog).getByRole('button', { name: 'Replace and Import' }));
    await waitFor(() => expect(restoreAndActivateCustomTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: firstTheme.id }),
      true,
    ));
  });

  it('keeps invalid pasted JSON visible as an inline import error', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    const importDialog = screen.getByRole('dialog', { name: 'Import Theme File' });
    expect(within(importDialog).getByRole('button', { name: 'Choose theme file' })).toBeInTheDocument();

    await user.type(within(importDialog).getByRole('textbox', { name: 'Theme JSON' }), 'not-json');
    await user.click(within(importDialog).getByRole('button', { name: 'Import' }));

    expect(await within(importDialog).findByRole('alert')).toHaveTextContent('Import failed:');
    expect(screen.getByRole('dialog', { name: 'Import Theme File' })).toBeInTheDocument();
  });

  it('imports an older v2 file through the visible dialog file action', async () => {
    const user = userEvent.setup();
    const importedTheme = createThemeConfig('Older V2 Theme', 'polar', 'org.example.older-v2');
    const olderV2 = toThemeFile(importedTheme);
    delete olderV2.tokens['--palette-white-text'];
    const { container } = render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    const importDialog = screen.getByRole('dialog', { name: 'Import Theme File' });
    expect(within(importDialog).getByRole('button', { name: 'Choose theme file' })).toBeInTheDocument();

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"][accept*="axiom-theme.json"]');
    expect(fileInput).not.toBeNull();
    await user.upload(fileInput!, new File(
      [JSON.stringify(olderV2)],
      'older-v2.axiom-theme.json',
      { type: 'application/json' },
    ));

    await waitFor(() => expect(restoreAndActivateCustomTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        id: importedTheme.id,
        colors: expect.objectContaining({
          '--palette-white-text': '#44476A',
        }),
      }),
      false,
    ));
    expect(screen.queryByRole('dialog', { name: 'Import Theme File' })).not.toBeInTheDocument();
  });

  it('installs and activates a non-conflicting import through the combined Core flow', async () => {
    const user = userEvent.setup();
    const importedTheme = createThemeConfig('Imported Theme', 'brutalist', 'org.example.imported');
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    const importDialog = screen.getByRole('dialog', { name: 'Import Theme File' });
    const jsonInput = within(importDialog).getByRole('textbox', { name: 'Theme JSON' });
    await user.click(jsonInput);
    await user.paste(JSON.stringify(toThemeFile(importedTheme)));
    await user.click(within(importDialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(restoreAndActivateCustomTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: importedTheme.id }),
      false,
    ));
    expect(screen.queryByRole('dialog', { name: 'Replace Installed Theme?' })).not.toBeInTheDocument();
  });

  it('creates and activates a new theme through the combined Core flow', async () => {
    const user = userEvent.setup();
    render(<ThemeBuilder />);

    await screen.findByRole('textbox', { name: 'Theme Name' });
    await user.click(screen.getByRole('button', { name: 'New' }));
    const createDialog = screen.getByRole('dialog', { name: 'Create Theme' });
    await user.type(within(createDialog).getByRole('textbox', { name: 'Theme Name' }), 'Created Theme');
    await user.click(within(createDialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(restoreAndActivateCustomTheme).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Created Theme' }),
      false,
    ));
  });
});
