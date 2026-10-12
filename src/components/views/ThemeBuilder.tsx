import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'sonner';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileJson,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Monitor,
  MousePointer2,
  Network,
  Palette,
  PanelLeft,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Type,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  ALL_THEME_VARIABLES,
  type ThemePresetId,
  type ThemeRecipes,
  type ThemeTokenMap,
  type ThemeTypography,
  type ThemeVariableType,
  type ThemeBranding,
  type ThemeEmbeddedAsset,
} from '../../theme/themeContract';
import { getBuiltInThemeIdForPreset, getPresetTokens, THEME_PRESET_OPTIONS } from '../../theme/presets';
import {
  createImportedThemeConfig,
  createThemeConfig,
  createThemeId,
  getThemeBasePresetId,
  getThemeConfigTokens,
  getThemeFileName,
  MAX_THEME_FILE_BYTES,
  MAX_THEME_ASSET_BYTES,
  toThemeFile,
} from '../../theme/themeFiles';
import { createThemeEmbeddedAsset } from '../../theme/themeAssets';
import {
  createThemeFontFaceCss,
  resolveThemePresentation,
} from '../../theme/themePresentation';
import { ThemeConfig } from '../../types';
import { CanvasThemePreview } from '../canvas/CanvasThemePreview';
import ConfirmationModal from '../shared/ConfirmationModal';
import { ApplicationThemePreview, DialogThemePreview, JournalThemePreview } from './theme-studio/ThemePreviewScenes';
import {
  NemotoButton,
  NemotoChoiceCard,
  NemotoDialog,
  NemotoDialogBody,
  NemotoDialogFooter,
  NemotoDialogHeader,
  NemotoInput,
  NemotoMenu,
  NemotoMenuItem,
  NemotoPanel,
  NemotoPanelHeader,
  NemotoPanelRowButton,
  NemotoRange,
  NemotoSelect,
  NemotoTextarea,
} from '../ui';

type PreviewScene = 'app' | 'journal' | 'canvas' | 'dialogs';
type StudioElementGroup = 'foundations' | 'shell' | 'components' | 'workspaces';
type StudioOperation = 'create' | 'save' | 'apply' | 'duplicate' | 'delete' | 'import';
type PendingStudioNavigation =
  | { kind: 'select-theme'; themeId: string }
  | { kind: 'select-baseline'; presetId: ThemePresetId }
  | { kind: 'create' }
  | { kind: 'import' }
  | { kind: 'file-import' };

interface StudioTokenControl {
  token: string;
  label?: string;
  description?: string;
  max?: number;
}

interface StudioControlSection {
  title: string;
  description?: string;
  tokens: StudioTokenControl[];
}

interface StudioElementDefinition {
  id: string;
  label: string;
  group: StudioElementGroup;
  scene: PreviewScene;
  description: string;
  icon: LucideIcon;
  sections: StudioControlSection[];
}

const DEFAULT_THEME_TOKENS = getPresetTokens('void');
const TOKEN_DEFINITION_MAP = new Map(ALL_THEME_VARIABLES.map(variable => [variable.name, variable]));

const ELEMENT_GROUPS: Array<{ id: StudioElementGroup; label: string }> = [
  { id: 'foundations', label: 'Core Theme' },
  { id: 'shell', label: 'Application' },
  { id: 'components', label: 'Components' },
  { id: 'workspaces', label: 'Workspaces' },
];

const STUDIO_ELEMENTS: StudioElementDefinition[] = [
  {
    id: 'branding',
    label: 'Brand & Typography',
    group: 'foundations',
    scene: 'app',
    description: 'Product name, offline logo, and embedded interface typeface.',
    icon: Type,
    sections: [],
  },
  {
    id: 'recipes',
    label: 'Visual Recipes',
    group: 'foundations',
    scene: 'app',
    description: 'Core-rendered density, corners, elevation, surfaces, controls, and nodes.',
    icon: Sparkles,
    sections: [],
  },
  {
    id: 'foundations',
    label: 'Color & Shape',
    group: 'foundations',
    scene: 'app',
    description: 'Global surfaces, text, accent, borders, and geometry.',
    icon: Sparkles,
    sections: [
      {
        title: 'Fill',
        description: 'Base backgrounds for the application frame and working surfaces.',
        tokens: [
          { token: '--color-app-bg', label: 'App Background' },
          { token: '--color-app-surface', label: 'Surface' },
          { token: '--color-app-header', label: 'Header' },
        ],
      },
      {
        title: 'Text',
        description: 'Primary, secondary, and supporting text colors.',
        tokens: [
          { token: '--color-text-main', label: 'Primary Text' },
          { token: '--color-text-muted', label: 'Secondary Text' },
          { token: '--color-text-faint', label: 'Faint Text' },
          { token: '--color-accent-primary-text', label: 'Accent Text' },
        ],
      },
      {
        title: 'Accent',
        description: 'The main brand/action color used across highlights and links.',
        tokens: [
          { token: '--color-accent-primary', label: 'Primary Accent' },
          { token: '--color-accent-success', label: 'Success Accent' },
          { token: '--color-accent-warning', label: 'Warning Accent' },
          { token: '--color-accent-purple', label: 'Purple Accent' },
          { token: '--color-accent-neutral', label: 'Neutral Accent' },
        ],
      },
      {
        title: 'Border & Shape',
        description: 'Global geometry used by panels, dialogs, controls, and nodes.',
        tokens: [
          { token: '--color-app-border', label: 'Border Color' },
          { token: '--app-radius-sm', label: 'Small Radius', max: 32 },
          { token: '--app-radius-md', label: 'Medium Radius', max: 40 },
          { token: '--app-radius-lg', label: 'Large Radius', max: 56 },
          { token: '--app-border-width', label: 'Border Width', max: 6 },
        ],
      },
    ],
  },
  {
    id: 'app-shell',
    label: 'Frame & Navigation',
    group: 'shell',
    scene: 'app',
    description: 'The persistent header, navigation rail, and workspace frame.',
    icon: Monitor,
    sections: [
      {
        title: 'Frame',
        description: 'Persistent app chrome around the active workspace.',
        tokens: [
          { token: '--color-app-header', label: 'Top Header' },
          { token: '--color-app-sidebar', label: 'Sidebars' },
          { token: '--color-app-bg', label: 'Workspace' },
          { token: '--color-app-border', label: 'Separators' },
        ],
      },
      {
        title: 'Navigation',
        description: 'Rail, dock, and their active states.',
        tokens: [
          { token: '--color-rail-bg', label: 'Rail Background' },
          { token: '--color-rail-button-text', label: 'Rail Button Text' },
          { token: '--color-rail-button-hover', label: 'Rail Button Hover' },
          { token: '--color-rail-button-active-bg', label: 'Active Rail' },
          { token: '--color-rail-button-active-text', label: 'Active Rail Text' },
          { token: '--color-dock-bg', label: 'Dock Background' },
          { token: '--color-dock-border', label: 'Dock Border' },
          { token: '--color-dock-button-bg', label: 'Dock Button Background' },
          { token: '--color-dock-button-text', label: 'Dock Button Text' },
          { token: '--color-dock-button-hover', label: 'Dock Button Hover' },
          { token: '--color-dock-button-active-bg', label: 'Active Dock Button' },
          { token: '--color-dock-button-active-text', label: 'Active Dock Button Text' },
          { token: '--color-dock-divider', label: 'Dock Divider' },
        ],
      },
    ],
  },
  {
    id: 'panels',
    label: 'Side Panels',
    group: 'shell',
    scene: 'app',
    description: 'Portfolio, resource, and inspector panels with row states.',
    icon: PanelLeft,
    sections: [
      {
        title: 'Fill & Rows',
        description: 'Panel surfaces, rows, hover, and selected states.',
        tokens: [
          { token: '--color-app-sidebar', label: 'Panel Background' },
          { token: '--color-app-header', label: 'Panel Header' },
          { token: '--color-app-surface', label: 'Panel Card' },
          { token: '--color-app-hover', label: 'Hover Row' },
          { token: '--color-app-active', label: 'Selected Row' },
          { token: '--color-app-border', label: 'Panel Border' },
        ],
      },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    group: 'components',
    scene: 'app',
    description: 'Buttons, fields, menus, and interactive states.',
    icon: MousePointer2,
    sections: [
      {
        title: 'Buttons',
        description: 'Default and primary button fills, text, borders, and hover state.',
        tokens: [
          { token: '--color-control-bg', label: 'Button Background' },
          { token: '--color-control-text', label: 'Button Text' },
          { token: '--color-control-border', label: 'Button Border' },
          { token: '--color-control-hover', label: 'Button Hover' },
          { token: '--color-control-active', label: 'Button Active' },
          { token: '--color-control-primary-bg', label: 'Primary Button' },
          { token: '--color-control-primary-text', label: 'Primary Button Text' },
        ],
      },
      {
        title: 'Fields & Menus',
        description: 'Editable fields, popover surfaces, and menu hover state.',
        tokens: [
          { token: '--color-app-input', label: 'App Input Background' },
          { token: '--color-field-bg', label: 'Field Background' },
          { token: '--color-field-text', label: 'Field Text' },
          { token: '--color-field-border', label: 'Field Border' },
          { token: '--color-menu-bg', label: 'Menu Background' },
          { token: '--color-menu-text', label: 'Menu Text' },
          { token: '--color-menu-border', label: 'Menu Border' },
          { token: '--color-menu-hover', label: 'Menu Hover' },
          { token: '--color-menu-separator', label: 'Menu Separator' },
        ],
      },
    ],
  },
  {
    id: 'dialogs',
    label: 'Dialogs',
    group: 'components',
    scene: 'dialogs',
    description: 'Modal panels, confirmation dialogs, picker rows, and actions.',
    icon: MessageSquare,
    sections: [
      {
        title: 'Frame',
        description: 'Dialog surface, header/footer, backdrop source, and border.',
        tokens: [
          { token: '--color-app-bg', label: 'Backdrop Source' },
          { token: '--color-app-surface', label: 'Dialog Panel' },
          { token: '--color-app-header', label: 'Header/Footer' },
          { token: '--color-app-border', label: 'Dialog Border' },
        ],
      },
      {
        title: 'Rows & Actions',
        description: 'Picker rows, selected rows, and destructive/primary actions.',
        tokens: [
          { token: '--color-app-hover', label: 'Row Hover' },
          { token: '--color-app-active', label: 'Selected Row' },
          { token: '--color-control-primary-bg', label: 'Primary Action' },
          { token: '--color-accent-danger', label: 'Danger Action' },
        ],
      },
    ],
  },
  {
    id: 'journal',
    label: 'Journal',
    group: 'workspaces',
    scene: 'journal',
    description: 'Journal tree, document surface, toolbar, tags, and linked context.',
    icon: BookOpen,
    sections: [
      {
        title: 'Structure',
        description: 'Tree, document, header, toolbar, and separators.',
        tokens: [
          { token: '--color-app-bg', label: 'Workspace' },
          { token: '--color-app-sidebar', label: 'Tree Panel' },
          { token: '--color-app-surface', label: 'Document Surface' },
          { token: '--color-app-header', label: 'Toolbar/Header' },
          { token: '--color-app-border', label: 'Separators' },
        ],
      },
      {
        title: 'Typography',
        description: 'Document body, metadata, headings, links, and inline references.',
        tokens: [
          { token: '--color-text-main', label: 'Document Text' },
          { token: '--color-text-muted', label: 'Secondary Text' },
          { token: '--color-text-faint', label: 'Metadata' },
          { token: '--color-accent-primary', label: 'Headings/Links' },
        ],
      },
    ],
  },
  {
    id: 'canvas-nodes',
    label: 'Canvas Nodes',
    group: 'workspaces',
    scene: 'canvas',
    description: 'Process nodes, palette colors, grid, edges, and selected states.',
    icon: Network,
    sections: [
      {
        title: 'Canvas',
        description: 'Canvas background, grid, and guide/edge color.',
        tokens: [
          { token: '--color-app-bg', label: 'Canvas Background' },
          { token: '--color-app-grid', label: 'Grid' },
          { token: '--color-canvas-edge', label: 'Edges' },
          { token: '--color-app-border', label: 'Guides & Separators' },
        ],
      },
      {
        title: 'Node Palette',
        description: 'Semantic node colors for process maps and white-label themes.',
        tokens: [
          { token: '--palette-blue', label: 'Action Node' },
          { token: '--palette-green', label: 'Start Node' },
          { token: '--palette-gray', label: 'Decision Node' },
          { token: '--palette-purple', label: 'System Node' },
          { token: '--palette-orange', label: 'Orange' },
          { token: '--palette-red', label: 'End Node' },
          { token: '--palette-amber', label: 'Note Node' },
          { token: '--palette-white', label: 'Light Node' },
          { token: '--palette-white-text', label: 'Light Node Text' },
        ],
      },
      {
        title: 'Node Shape',
        description: 'Shared geometry for rounded canvas nodes and node border weight.',
        tokens: [
          { token: '--app-radius-node', label: 'Node Radius', max: 40 },
          { token: '--app-node-border-width', label: 'Node Border Width', max: 8 },
        ],
      },
      {
        title: 'Event Node',
        description: 'Semantic Event surface, border, text, and kind/behavior accent.',
        tokens: [
          { token: '--color-node-event-bg', label: 'Event Background' },
          { token: '--color-node-event-border', label: 'Event Border' },
          { token: '--color-node-event-text', label: 'Event Text' },
          { token: '--color-node-event-accent', label: 'Event Accent' },
        ],
      },
    ],
  },
];

const isHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value.trim());
const parseLength = (value: string): number => parseInt(value, 10) || 0;

const getTokenType = (token: string): ThemeVariableType => (
  TOKEN_DEFINITION_MAP.get(token)?.type || (token.includes('radius') || token.includes('width') ? 'length' : 'color')
);

const getTokenLabel = (control: StudioTokenControl): string => (
  control.label || TOKEN_DEFINITION_MAP.get(control.token)?.label || control.token
);

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
};

const getAvailableAssetId = (
  preferredId: string,
  currentId: string | undefined,
  assets: Record<string, ThemeEmbeddedAsset>,
): string => {
  if (currentId) return currentId;
  if (!assets[preferredId]) return preferredId;
  let suffix = 2;
  while (assets[`${preferredId}-${suffix}`]) suffix += 1;
  return `${preferredId}-${suffix}`;
};

export const createThemeExportSource = (
  selectedTheme: ThemeConfig | undefined,
  themeName: string,
  colors: ThemeTokenMap,
  basePresetId: ThemePresetId,
  presentation?: {
    brand: ThemeBranding;
    typography: ThemeTypography;
    assets: Record<string, ThemeEmbeddedAsset>;
    recipes: ThemeRecipes;
  },
): ThemeConfig => ({
  ...(selectedTheme || {
    id: 'custom-preview',
    label: 'Preview Theme',
    colors,
  }),
  label: themeName.trim() || selectedTheme?.label || 'Preview Theme',
  basePresetId,
  colors: { ...colors },
  tokens: { ...colors },
  ...(presentation ? {
    brand: { ...presentation.brand },
    typography: { ...presentation.typography },
    assets: { ...presentation.assets },
    recipes: { ...presentation.recipes },
  } : {}),
});

export const ThemeBuilder: React.FC = () => {
  const {
    theme,
    customThemes,
    activeThemeId,
    themesInitialized,
    themeLibraryErrors,
    installCustomTheme,
    updateCustomTheme,
    restoreAndActivateCustomTheme,
    deleteCustomTheme,
    activateCustomTheme,
  } = useSettingsStore();

  const [selectedThemeId, setSelectedThemeId] = useState('');
  const [baselinePreviewPresetId, setBaselinePreviewPresetId] = useState<ThemePresetId>('void');
  const [themeName, setThemeName] = useState('');
  const [colors, setColors] = useState<ThemeTokenMap>({ ...DEFAULT_THEME_TOKENS });
  const [draftBasePresetId, setDraftBasePresetId] = useState<ThemePresetId>('void');
  const [brand, setBrand] = useState<ThemeBranding>({});
  const [typography, setTypography] = useState<ThemeTypography>({});
  const [themeAssets, setThemeAssets] = useState<Record<string, ThemeEmbeddedAsset>>({});
  const [recipes, setRecipes] = useState<ThemeRecipes>({});
  const [selectedElementId, setSelectedElementId] = useState(STUDIO_ELEMENTS[0].id);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newThemeName, setNewThemeName] = useState('');
  const [newBasePreset, setNewBasePreset] = useState<ThemePresetId>('void');
  const [showImportModal, setShowImportModal] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingStudioNavigation | null>(null);
  const [pendingThemeImport, setPendingThemeImport] = useState<{
    theme: ThemeConfig;
    source: 'text' | 'file';
  } | null>(null);
  const [operation, setOperation] = useState<StudioOperation | null>(null);
  const [elementsPanelOpen, setElementsPanelOpen] = useState(true);
  const [inspectorPanelOpen, setInspectorPanelOpen] = useState(true);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const hasUnsavedChangesRef = useRef(false);
  const allowWindowCloseRef = useRef(false);
  const initialThemeSelectionResolvedRef = useRef(false);

  const selectedTheme = useMemo(
    () => customThemes.find(theme => theme.id === selectedThemeId),
    [customThemes, selectedThemeId],
  );

  const selectedElement = useMemo(
    () => STUDIO_ELEMENTS.find(element => element.id === selectedElementId) || STUDIO_ELEMENTS[0],
    [selectedElementId],
  );

  const activeBaselinePresetId = useMemo<ThemePresetId>(() => (
    THEME_PRESET_OPTIONS.find(preset => preset.builtInThemeId === theme)?.id || 'void'
  ), [theme]);

  const draftTheme = useMemo(() => selectedTheme ? createThemeExportSource(
    selectedTheme,
    themeName,
    colors,
    draftBasePresetId,
    { brand, typography, assets: themeAssets, recipes },
  ) : undefined, [brand, colors, draftBasePresetId, recipes, selectedTheme, themeAssets, themeName, typography]);
  const draftPresentation = useMemo(() => resolveThemePresentation(draftTheme), [draftTheme]);
  const draftFontFaceCss = useMemo(() => createThemeFontFaceCss(draftPresentation), [draftPresentation]);

  const previewThemeId = getBuiltInThemeIdForPreset(draftBasePresetId);
  const baselineTokens = useMemo(() => getPresetTokens(draftBasePresetId), [draftBasePresetId]);
  const tokenOverrideCount = useMemo(() => ALL_THEME_VARIABLES.reduce((count, definition) => (
    colors[definition.name] !== baselineTokens[definition.name] ? count + 1 : count
  ), 0), [baselineTokens, colors]);
  const themeSelectionValue = selectedThemeId || `baseline:${baselinePreviewPresetId}`;
  const themeSelectionLabel = selectedTheme
    ? `${selectedTheme.label}${selectedTheme.id === activeThemeId ? ' â€¢ Active' : ''}`
    : `${THEME_PRESET_OPTIONS.find(preset => preset.id === baselinePreviewPresetId)?.label || 'Void'} baseline${
      baselinePreviewPresetId === activeBaselinePresetId && !activeThemeId ? ' Â· Active app' : ''
    }`;

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedTheme) return false;
    return selectedTheme.label !== themeName
      || selectedTheme.basePresetId !== draftBasePresetId
      || JSON.stringify(getThemeConfigTokens(selectedTheme)) !== JSON.stringify(colors)
      || JSON.stringify(selectedTheme.brand || {}) !== JSON.stringify(brand)
      || JSON.stringify(selectedTheme.typography || {}) !== JSON.stringify(typography)
      || JSON.stringify(selectedTheme.assets || {}) !== JSON.stringify(themeAssets)
      || JSON.stringify(selectedTheme.recipes || {}) !== JSON.stringify(recipes);
  }, [brand, colors, draftBasePresetId, recipes, selectedTheme, themeAssets, themeName, typography]);

  const isWorking = operation !== null;

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current || allowWindowCloseRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested((event) => {
      if (!hasUnsavedChangesRef.current || allowWindowCloseRef.current) return;
      event.preventDefault();
      setCloseConfirmOpen(true);
    });

    return () => {
      void unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  useEffect(() => {
    if (selectedThemeId) {
      if (!selectedTheme) {
        setSelectedThemeId('');
        return;
      }

      setThemeName(selectedTheme.label);
      setColors({ ...getThemeConfigTokens(selectedTheme) });
      setDraftBasePresetId(getThemeBasePresetId(selectedTheme.basePresetId) || 'void');
      setBrand({ ...(selectedTheme.brand || {}) });
      setTypography({ ...(selectedTheme.typography || {}) });
      setThemeAssets({ ...(selectedTheme.assets || {}) });
      setRecipes({ ...(selectedTheme.recipes || {}) });
      return;
    }

    setThemeName('');
    setColors(getPresetTokens(baselinePreviewPresetId));
    setDraftBasePresetId(baselinePreviewPresetId);
    setBrand({});
    setTypography({});
    setThemeAssets({});
    setRecipes({});
  }, [baselinePreviewPresetId, selectedTheme, selectedThemeId]);

  useEffect(() => {
    if (!themesInitialized || initialThemeSelectionResolvedRef.current) return;
    if (activeThemeId && customThemes.some(theme => theme.id === activeThemeId)) {
      setSelectedThemeId(activeThemeId);
    } else {
      setBaselinePreviewPresetId(activeBaselinePresetId);
    }
    initialThemeSelectionResolvedRef.current = true;
  }, [activeThemeId, customThemes, themesInitialized]);

  const broadcastThemeChange = async () => {
    if (isTauri()) await emit('theme-library-changed', { sender: 'theme-studio' });
  };

  const selectElement = (elementId: string) => {
    const element = STUDIO_ELEMENTS.find(item => item.id === elementId);
    if (!element) return;
    setSelectedElementId(element.id);
  };

  const executeNavigation = (navigation: PendingStudioNavigation) => {
    if (navigation.kind === 'select-theme') {
      setSelectedThemeId(navigation.themeId);
      return;
    }
    if (navigation.kind === 'select-baseline') {
      setSelectedThemeId('');
      setBaselinePreviewPresetId(navigation.presetId);
      return;
    }
    if (navigation.kind === 'create') {
      setNewBasePreset(draftBasePresetId);
      setShowCreateModal(true);
      return;
    }
    if (navigation.kind === 'import') {
      setImportError(null);
      setShowImportModal(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const requestNavigation = (navigation: PendingStudioNavigation) => {
    if (navigation.kind === 'select-theme' && navigation.themeId === selectedThemeId) return;
    if (navigation.kind === 'select-baseline'
      && !selectedThemeId
      && navigation.presetId === baselinePreviewPresetId) return;
    if (!hasUnsavedChanges) {
      executeNavigation(navigation);
      return;
    }
    setPendingNavigation(navigation);
    setDiscardConfirmOpen(true);
  };

  const confirmDiscardChanges = () => {
    if (pendingNavigation) executeNavigation(pendingNavigation);
    setPendingNavigation(null);
    setDiscardConfirmOpen(false);
  };

  const confirmWindowClose = async () => {
    allowWindowCloseRef.current = true;
    setCloseConfirmOpen(false);
    try {
      await getCurrentWindow().close();
    } catch (error) {
      allowWindowCloseRef.current = false;
      toast.error(getErrorMessage(error, 'Could not close Theme Studio.'));
    }
  };

  const handleTokenChange = (token: string, value: string) => {
    setColors(prev => ({ ...prev, [token]: value }));
  };

  const handleLengthChange = (token: string, value: number) => {
    setColors(prev => ({ ...prev, [token]: `${value}px` }));
  };

  const handleResetToken = (token: string) => {
    const baselineValue = baselineTokens[token];
    if (!baselineValue) return;
    setColors(current => ({ ...current, [token]: baselineValue }));
  };

  const handleLogoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_THEME_ASSET_BYTES) throw new Error('Logo exceeds the 2 MiB asset limit.');
      const lowerName = file.name.toLowerCase();
      const mediaType = file.type === 'image/png' || lowerName.endsWith('.png')
        ? 'image/png'
        : file.type === 'image/webp' || lowerName.endsWith('.webp')
          ? 'image/webp'
          : null;
      if (!mediaType) throw new Error('Logo must be a PNG or WebP image.');
      const asset = await createThemeEmbeddedAsset(file, mediaType);
      const assetId = getAvailableAssetId('brand-logo', brand.logoAssetId, themeAssets);
      setThemeAssets(current => ({ ...current, [assetId]: asset }));
      setBrand(current => ({ ...current, logoAssetId: assetId }));
      toast.success('Logo embedded in the theme draft.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add the logo.'));
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleFontFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_THEME_ASSET_BYTES) throw new Error('Font exceeds the 2 MiB asset limit.');
      if (!file.name.toLowerCase().endsWith('.woff2')) throw new Error('Interface font must be a WOFF2 file.');
      const asset = await createThemeEmbeddedAsset(file, 'font/woff2');
      const assetId = getAvailableAssetId('interface-font-regular', typography.regularAssetId, themeAssets);
      setThemeAssets(current => ({ ...current, [assetId]: asset }));
      setTypography(current => ({
        ...current,
        fontFamily: current.fontFamily || file.name.replace(/\.woff2$/i, ''),
        regularAssetId: assetId,
      }));
      toast.success('WOFF2 font embedded in the theme draft.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add the font.'));
    } finally {
      if (fontInputRef.current) fontInputRef.current.value = '';
    }
  };

  const handleCreateTheme = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!newThemeName.trim()) {
      toast.error('Please enter a theme name.');
      return;
    }

    if (isWorking) return;
    setOperation('create');
    try {
      const newTheme = createThemeConfig(newThemeName.trim(), newBasePreset);
      await restoreAndActivateCustomTheme(newTheme, false);
      await broadcastThemeChange();
      setSelectedThemeId(newTheme.id);
      setNewThemeName('');
      setShowCreateModal(false);
      toast.success(`Theme "${newTheme.label}" has been created.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not create the theme.'));
    } finally {
      setOperation(null);
    }
  };

  const handleSaveTheme = async () => {
    if (!selectedThemeId) {
      toast.error('Create or select a theme before saving.');
      return;
    }

    if (isWorking || !hasUnsavedChanges) return;
    const normalizedName = themeName.trim() || 'Untitled Theme';
    setOperation('save');
    try {
      await updateCustomTheme({ ...draftTheme!, label: normalizedName });
      await broadcastThemeChange();
      setThemeName(normalizedName);
      toast.success('Theme saved.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save the theme.'));
    } finally {
      setOperation(null);
    }
  };

  const handleApplyTheme = async () => {
    if (isWorking) return;
    setOperation('apply');
    if (!selectedThemeId) {
      try {
        await activateCustomTheme(null);
        await broadcastThemeChange();
        toast.success('Custom theme disabled. Built-in template active.');
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not activate the built-in theme.'));
      } finally {
        setOperation(null);
      }
      return;
    }

    try {
      const normalizedName = themeName.trim() || 'Untitled Theme';
      await updateCustomTheme({ ...draftTheme!, label: normalizedName });
      await activateCustomTheme(selectedThemeId);
      await broadcastThemeChange();
      setThemeName(normalizedName);
      toast.success(`Theme "${normalizedName}" applied.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not apply the theme.'));
    } finally {
      setOperation(null);
    }
  };

  const handleDuplicateTheme = async () => {
    if (!selectedTheme) {
      toast.error('Select a theme to duplicate.');
      return;
    }

    if (isWorking) return;
    const duplicatedTheme: ThemeConfig = {
      ...draftTheme!,
      id: createThemeId(`${themeName || selectedTheme.label} Copy`),
      label: `${themeName || selectedTheme.label} Copy`,
    };

    setOperation('duplicate');
    try {
      await installCustomTheme(duplicatedTheme);
      await broadcastThemeChange();
      setSelectedThemeId(duplicatedTheme.id);
      toast.success(`Theme "${duplicatedTheme.label}" created.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not duplicate the theme.'));
    } finally {
      setOperation(null);
    }
  };

  const confirmDeleteTheme = async () => {
    if (!selectedThemeId || isWorking) return;
    setOperation('delete');
    try {
      await deleteCustomTheme(selectedThemeId);
      await broadcastThemeChange();
      setSelectedThemeId('');
      setDeleteConfirmOpen(false);
      toast.success('Theme deleted.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not delete the theme.'));
    } finally {
      setOperation(null);
    }
  };

  const handleResetToPreset = (preset: ThemePresetId) => {
    setColors({ ...getPresetTokens(preset) });
    setDraftBasePresetId(preset);
    toast.success(`Public tokens reset to ${THEME_PRESET_OPTIONS.find(option => option.id === preset)?.label || preset}. Save to preserve.`);
  };

  const handleExportJSON = () => {
    const exportSource = draftTheme || createThemeExportSource(selectedTheme, themeName, colors, draftBasePresetId);
    const blob = new Blob([JSON.stringify(toThemeFile(exportSource), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getThemeFileName(exportSource.label);
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Theme file downloaded.');
  };

  const handleCopyJSON = async () => {
    const exportSource = draftTheme || createThemeExportSource(selectedTheme, themeName, colors, draftBasePresetId);
    try {
      await navigator.clipboard.writeText(JSON.stringify(toThemeFile(exportSource), null, 2));
      toast.success('Theme data copied.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not copy the theme data.'));
    }
  };

  const importTheme = async (value: unknown, source: 'text' | 'file') => {
    const newTheme = createImportedThemeConfig(value);
    if (customThemes.some(theme => theme.id === newTheme.id)) {
      setPendingThemeImport({ theme: newTheme, source });
      return;
    }
    await restoreAndActivateCustomTheme(newTheme, false);
    await broadcastThemeChange();
    setSelectedThemeId(newTheme.id);
    toast.success(`Theme "${newTheme.label}" imported from ${source}.`);
  };

  const confirmReplaceImportedTheme = async () => {
    const candidate = pendingThemeImport;
    if (!candidate || isWorking) return;

    setOperation('import');
    try {
      await restoreAndActivateCustomTheme(candidate.theme, true);
      await broadcastThemeChange();
      setSelectedThemeId(candidate.theme.id);
      toast.success(`Theme "${candidate.theme.label}" replaced and activated.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not replace the installed theme.'));
    } finally {
      setOperation(null);
    }
  };

  const handleImportText = async () => {
    if (isWorking) return;
    setImportError(null);
    setOperation('import');
    try {
      if (new TextEncoder().encode(jsonText).byteLength > MAX_THEME_FILE_BYTES) {
        throw new Error('Theme file exceeds the 8 MiB limit.');
      }
      await importTheme(JSON.parse(jsonText), 'text');
      setShowImportModal(false);
      setJsonText('');
    } catch (error: unknown) {
      const message = `Import failed: ${getErrorMessage(error, 'Invalid JSON format')}`;
      setImportError(message);
      toast.error(message);
    } finally {
      setOperation(null);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (isWorking) return;
    setImportError(null);
    setOperation('import');
    try {
      if (file.size > MAX_THEME_FILE_BYTES) {
        throw new Error('Theme file exceeds the 8 MiB limit.');
      }
      await importTheme(JSON.parse(await file.text()), 'file');
      setShowImportModal(false);
      setJsonText('');
    } catch (error: unknown) {
      const message = `Could not import file: ${getErrorMessage(error, 'Invalid JSON')}`;
      setImportError(message);
      setShowImportModal(true);
      toast.error(message);
    } finally {
      setOperation(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const previewStyles = { ...colors, ...draftPresentation.variables } as React.CSSProperties;

  const targetClass = (elementId: string, className = ''): string => (
    `theme-studio-preview-target ${selectedElementId === elementId ? 'is-selected' : ''} ${className}`.trim()
  );

  const renderTokenControl = (control: StudioTokenControl) => {
    const value = colors[control.token] || '';
    const baselineValue = baselineTokens[control.token] || '';
    const isOverridden = value !== baselineValue;
    const tokenType = getTokenType(control.token);
    const label = getTokenLabel(control);
    const resetButton = isOverridden ? (
      <NemotoButton
        icon
        size="sm"
        variant="ghost"
        aria-label={`Reset ${label} to baseline`}
        title={`Reset to ${baselineValue}`}
        onClick={() => handleResetToken(control.token)}
      >
        <RotateCcw size={12} />
      </NemotoButton>
    ) : null;

    if (tokenType === 'length') {
      const max = control.max ?? (control.token.includes('width') ? 8 : 48);
      return (
        <div key={control.token} data-theme-token={control.token} className={`theme-studio-token-card ${isOverridden ? 'is-overridden' : ''} p-3 space-y-2`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-text-main">{label}</div>
              <div className="theme-studio-token-meta font-mono truncate">{control.token} Â· length</div>
            </div>
            <div className="flex items-center gap-1">
              {resetButton}
              <NemotoInput
                aria-label={`${label} value`}
                value={value}
                onChange={(event) => handleTokenChange(control.token, event.target.value)}
                controlSize="xs"
                className="w-16 text-center font-mono"
              />
            </div>
          </div>
          <NemotoRange
            aria-label={`${label} slider`}
            min={0}
            max={max}
            value={parseLength(value)}
            onChange={(event) => handleLengthChange(control.token, Number(event.target.value))}
            className="w-full"
          />
        </div>
      );
    }

    return (
      <div key={control.token} data-theme-token={control.token} className={`theme-studio-token-card ${isOverridden ? 'is-overridden' : ''} p-3 space-y-2`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-text-main">{label}</div>
            <div className="theme-studio-token-meta font-mono truncate">{control.token} Â· color</div>
          </div>
          <div className="flex items-center gap-1">
            {resetButton}
            <label className="theme-studio-color-picker relative h-8 w-8 shrink-0 overflow-hidden rounded-md cursor-pointer">
              <div className="absolute inset-0" style={{ background: value || 'transparent' }} />
              <input
                aria-label={`${label} color picker`}
                type="color"
                value={isHexColor(value) ? value : '#000000'}
                onChange={(event) => handleTokenChange(control.token, event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
        <NemotoInput
          aria-label={`${label} value`}
          value={value}
          onChange={(event) => handleTokenChange(control.token, event.target.value)}
          controlSize="xs"
          className="w-full font-mono"
        />
      </div>
    );
  };

  const renderBrandingInspector = () => {
    const logoAsset = brand.logoAssetId ? themeAssets[brand.logoAssetId] : undefined;
    const regularFontAsset = typography.regularAssetId ? themeAssets[typography.regularAssetId] : undefined;
    const formatAssetSize = (asset: ThemeEmbeddedAsset | undefined): string => {
      if (!asset) return '';
      const padding = asset.data.endsWith('==') ? 2 : asset.data.endsWith('=') ? 1 : 0;
      return `${Math.max(0, Math.floor(asset.data.length * 3 / 4) - padding).toLocaleString()} bytes`;
    };

    return (
      <div className="space-y-5">
        <section className="theme-studio-inspector-section space-y-3">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-main">Product Identity</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-text-faint">Used in the application header and exported HTML viewer.</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-main">
            <input type="checkbox" checked={brand.showDisplayName !== false}
              onChange={event => setBrand(current => ({ ...current, showDisplayName: event.target.checked }))} />
            Show display name
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Display Name</span>
            <NemotoInput
              controlSize="sm"
              value={brand.displayName || ''}
              maxLength={128}
              onChange={(event) => setBrand(current => ({ ...current, displayName: event.target.value || undefined }))}
              className="w-full"
              placeholder="Nemoto"
            />
          </label>
        </section>

        <section className="theme-studio-inspector-section space-y-3">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-main">Offline Logo</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-text-faint">PNG or WebP, embedded directly in the theme file. Maximum 2 MiB. Rectangular logos keep their proportions.</p>
          </div>
          {draftPresentation.logoDataUrl ? (
            <div className="theme-studio-token-card flex flex-col items-stretch gap-3 p-3">
              <img aria-hidden="true" alt="" src={draftPresentation.logoDataUrl} className="h-20 w-full object-contain object-left" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-text-main">{brand.logoAssetId}</div>
                <div className="theme-studio-token-meta">{logoAsset?.mediaType} Â· {formatAssetSize(logoAsset)}</div>
              </div>
            </div>
          ) : (
            <div className="theme-studio-token-card flex items-center gap-3 p-3 text-xs text-text-muted">
              <ImageIcon size={20} className="text-text-faint" />
              Built-in Nemoto mark is used as fallback.
            </div>
          )}
          <input ref={logoInputRef} className="hidden" type="file" accept="image/png,image/webp,.png,.webp" onChange={handleLogoFile} />
          <div className="grid grid-cols-2 gap-2">
            <NemotoButton size="sm" onClick={() => logoInputRef.current?.click()}>
              <Upload size={13} /> {draftPresentation.logoDataUrl ? 'Replace' : 'Choose Logo'}
            </NemotoButton>
            <NemotoButton
              size="sm"
              disabled={!brand.logoAssetId}
              onClick={() => setBrand(current => ({ ...current, logoAssetId: undefined }))}
            >
              <X size={13} /> Clear Reference
            </NemotoButton>
          </div>
        </section>

        <section className="theme-studio-inspector-section space-y-3">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-main">Interface Typeface</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-text-faint">A WOFF2 regular face is embedded and used for UI and headings. Medium and bold files remain available through JSON.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Family Label</span>
            <NemotoInput
              controlSize="sm"
              value={typography.fontFamily || ''}
              maxLength={256}
              onChange={(event) => setTypography(current => ({ ...current, fontFamily: event.target.value || undefined }))}
              className="w-full"
              placeholder="My Brand Sans"
            />
          </label>
          {regularFontAsset && (
            <div className="theme-studio-token-card p-3">
              <div className="truncate text-xs font-bold text-text-main">{typography.regularAssetId}</div>
              <div className="theme-studio-token-meta">WOFF2 Â· {formatAssetSize(regularFontAsset)}</div>
            </div>
          )}
          <input ref={fontInputRef} className="hidden" type="file" accept="font/woff2,.woff2" onChange={handleFontFile} />
          <div className="grid grid-cols-2 gap-2">
            <NemotoButton size="sm" onClick={() => fontInputRef.current?.click()}>
              <Upload size={13} /> {regularFontAsset ? 'Replace' : 'Choose WOFF2'}
            </NemotoButton>
            <NemotoButton
              size="sm"
              disabled={!typography.regularAssetId && !typography.mediumAssetId && !typography.boldAssetId}
              onClick={() => setTypography(current => ({
                ...current,
                regularAssetId: undefined,
                mediumAssetId: undefined,
                boldAssetId: undefined,
              }))}
            >
              <X size={13} /> Clear References
            </NemotoButton>
          </div>
        </section>
      </div>
    );
  };

  const renderRecipeInspector = () => {
    const definitions: Array<{
      key: 'density' | 'cornerStyle' | 'elevation' | 'controlStyle' | 'surfaceStyle' | 'nodeStyle';
      label: string;
      description: string;
      options: Array<{ value: string; label: string }>;
    }> = [
      {
        key: 'density',
        label: 'Density',
        description: 'Shared sizing for buttons, fields, icons, menus, rails, docks, and rows.',
        options: [
          { value: 'compact', label: 'Compact' },
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'spacious', label: 'Spacious' },
        ],
      },
      {
        key: 'cornerStyle',
        label: 'Corner Style',
        description: 'Control, dock, and dialog corner treatment.',
        options: [
          { value: 'square', label: 'Square' },
          { value: 'soft', label: 'Soft' },
          { value: 'rounded', label: 'Rounded' },
        ],
      },
      {
        key: 'elevation',
        label: 'Elevation',
        description: 'Core-owned shadow recipe for surfaces and overlays.',
        options: [
          { value: 'flat', label: 'Flat' },
          { value: 'subtle', label: 'Subtle' },
          { value: 'raised', label: 'Raised' },
          { value: 'graphic', label: 'Graphic' },
        ],
      },
      {
        key: 'controlStyle',
        label: 'Control Treatment',
        description: 'Border, shadow, and pressed-state behavior for controls.',
        options: [
          { value: 'flat', label: 'Flat' },
          { value: 'outlined', label: 'Outlined' },
          { value: 'raised', label: 'Raised' },
          { value: 'graphic', label: 'Graphic' },
        ],
      },
      {
        key: 'surfaceStyle',
        label: 'Surface Treatment',
        description: 'Core-owned panel, menu, and dialog layering without custom CSS.',
        options: [
          { value: 'solid', label: 'Solid' },
          { value: 'layered', label: 'Layered' },
          { value: 'translucent', label: 'Translucent' },
        ],
      },
      {
        key: 'nodeStyle',
        label: 'Node Treatment',
        description: 'Shared border, shadow, label, hover, and selection treatment for process nodes.',
        options: [
          { value: 'minimal', label: 'Minimal' },
          { value: 'outlined', label: 'Outlined' },
          { value: 'raised', label: 'Raised' },
          { value: 'graphic', label: 'Graphic' },
        ],
      },
    ];

    return (
      <div className="space-y-3">
        {definitions.map(definition => (
          <section key={definition.key} className="theme-studio-inspector-section space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-main" htmlFor={`theme-recipe-${definition.key}`}>
              {definition.label}
            </label>
            <p className="text-[10px] leading-relaxed text-text-faint">{definition.description}</p>
            <NemotoSelect
              id={`theme-recipe-${definition.key}`}
              controlSize="sm"
              className="w-full"
              value={typeof recipes[definition.key] === 'string' ? recipes[definition.key] : ''}
              onChange={(event) => setRecipes(current => ({
                ...current,
                [definition.key]: event.target.value || undefined,
              }))}
            >
              <option value="">Baseline default</option>
              {definition.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </NemotoSelect>
          </section>
        ))}
        <p className="text-[10px] leading-relaxed text-text-faint">Unknown recipe fields remain in JSON but are inert until Core supports them.</p>
      </div>
    );
  };

  const renderCanvasPreview = () => (
    <div
      className={targetClass('canvas-nodes', 'relative h-full overflow-hidden bg-app-bg text-text-main')}
      onClick={() => selectElement('canvas-nodes')}
    >
      <CanvasThemePreview themeId={previewThemeId} />
    </div>
  );

  const renderPreviewScene = () => {
    if (selectedElement.scene === 'journal') {
      return <JournalThemePreview selectedElementId={selectedElementId} onSelectElement={selectElement} />;
    }
    if (selectedElement.scene === 'canvas') return renderCanvasPreview();
    if (selectedElement.scene === 'dialogs') {
      return <DialogThemePreview selectedElementId={selectedElementId} onSelectElement={selectElement} />;
    }
    return (
      <ApplicationThemePreview
        selectedElementId={selectedElementId}
        onSelectElement={selectElement}
        themeId={previewThemeId}
        brandPresentation={draftPresentation}
      />
    );
  };

  return (
    <div className="theme-studio-shell h-full w-full bg-app-bg text-text-main flex flex-col overflow-hidden select-none">
      <NemotoPanelHeader className="theme-studio-toolbar border-b flex items-center justify-between gap-4 px-4 shrink-0">
        <div className="theme-studio-toolbar-copy flex items-center gap-3 min-w-0">
          <div className="nemoto-dialog-icon nemoto-dialog-icon-primary p-2">
            <Palette size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-black uppercase tracking-wider">Theme Studio</h1>
              {hasUnsavedChanges && (
                <span className="theme-studio-status-badge" role="status" aria-live="polite">
                  <span aria-hidden="true" className="theme-studio-status-dot" />
                  Unsaved
                </span>
              )}
              {themeLibraryErrors.length > 0 && (
                <span
                  className="theme-studio-status-badge theme-studio-status-badge-warning"
                  role="alert"
                  title={themeLibraryErrors.map(error => `${error.fileName}: ${error.message}`).join('\n')}
                >
                  {themeLibraryErrors.length} invalid
                </span>
              )}
            </div>
            <p className="theme-studio-toolbar-description text-[10px] text-text-faint truncate">Select an element, edit properties, and preview changes live.</p>
          </div>
        </div>

        <div className="theme-studio-toolbar-actions flex items-center justify-end gap-2 min-w-0">
          <div className="theme-studio-theme-picker relative">
            <NemotoButton
              aria-label="Theme to preview or edit"
              aria-expanded={themeMenuOpen}
              aria-haspopup="menu"
              className="theme-studio-theme-select justify-between text-sm"
              disabled={isWorking}
              onClick={() => setThemeMenuOpen(open => !open)}
              size="sm"
            >
              <span className="truncate">{themeSelectionLabel}</span>
              <ChevronDown aria-hidden="true" className="shrink-0 text-text-faint" size={14} />
            </NemotoButton>
            {themeMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
                <NemotoMenu
                  aria-label="Themes to preview or edit"
                  className="theme-studio-theme-menu nemoto-scroll-menu absolute left-0 right-0 top-full z-50 mt-1"
                  onClose={() => setThemeMenuOpen(false)}
                  surface="file"
                >
                  <div className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-text-faint" role="presentation">
                    Built-in baselines
                  </div>
                  {THEME_PRESET_OPTIONS.map(preset => {
                    const value = `baseline:${preset.id}`;
                    return (
                      <NemotoMenuItem
                        aria-checked={themeSelectionValue === value}
                        autoFocus={themeSelectionValue === value}
                        key={preset.id}
                        onClick={() => {
                          setThemeMenuOpen(false);
                          requestNavigation({ kind: 'select-baseline', presetId: preset.id });
                        }}
                        role="menuitemradio"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {preset.label} baseline{preset.id === activeBaselinePresetId && !activeThemeId ? ' Â· Active app' : ''}
                        </span>
                        {themeSelectionValue === value && <Check aria-hidden="true" size={13} />}
                      </NemotoMenuItem>
                    );
                  })}
                  <div className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-text-faint" role="presentation">
                    Installed themes
                  </div>
                  {customThemes.map(themeOption => (
                    <NemotoMenuItem
                      aria-checked={themeSelectionValue === themeOption.id}
                      autoFocus={themeSelectionValue === themeOption.id}
                      key={themeOption.id}
                      onClick={() => {
                        setThemeMenuOpen(false);
                        requestNavigation({ kind: 'select-theme', themeId: themeOption.id });
                      }}
                      role="menuitemradio"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {themeOption.label}{themeOption.id === activeThemeId ? ' â€¢ Active' : ''}
                      </span>
                      {themeSelectionValue === themeOption.id && <Check aria-hidden="true" size={13} />}
                    </NemotoMenuItem>
                  ))}
                </NemotoMenu>
              </>
            )}
          </div>
          <NemotoButton size="sm" onClick={() => requestNavigation({ kind: 'create' })} disabled={isWorking}>
            <Plus size={14} />
            New
          </NemotoButton>
          <NemotoButton size="sm" onClick={() => requestNavigation({ kind: 'import' })} disabled={isWorking}>
            <Upload size={14} />
            Import
          </NemotoButton>
          <input ref={fileInputRef} type="file" accept=".json,.axiom-theme.json" onChange={handleImportFile} className="hidden" />
          <NemotoButton icon size="sm" onClick={() => requestNavigation({ kind: 'file-import' })} aria-label="Choose theme file" title="Choose theme file" disabled={isWorking}>
            <FileJson size={14} />
          </NemotoButton>
        </div>
      </NemotoPanelHeader>

      <div
        className="theme-studio-layout min-h-0 flex-1"
        data-elements-panel={elementsPanelOpen ? 'open' : 'closed'}
        data-inspector-panel={inspectorPanelOpen ? 'open' : 'closed'}
        data-testid="theme-studio-layout"
      >
        {elementsPanelOpen && (
        <NemotoPanel as="aside" className="theme-studio-elements-panel nemoto-side-panel border-r flex flex-col min-h-0 overflow-hidden" data-testid="theme-studio-elements-panel">
          <NemotoPanelHeader className="border-b p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-faint">
              <Layers size={14} />
              <span className="theme-studio-elements-header-label">Elements</span>
            </div>
          </NemotoPanelHeader>
          <nav aria-label="Theme elements" className="theme-studio-elements-body flex-1 overflow-y-auto custom-scrollbar p-3 space-y-5">
            {ELEMENT_GROUPS.map(group => (
              <section key={group.id} className="space-y-1">
                <div className="theme-studio-elements-group-label px-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">{group.label}</div>
                {STUDIO_ELEMENTS.filter(element => element.group === group.id).map(element => {
                  const Icon = element.icon;
                  const isSelected = selectedElementId === element.id;

                  return (
                    <NemotoPanelRowButton
                      key={element.id}
                      selected={isSelected}
                      onClick={() => selectElement(element.id)}
                      className="theme-studio-element-row w-full flex items-start gap-3 px-2 py-2 text-left"
                      aria-pressed={isSelected}
                      aria-label={element.label}
                      title={`${element.label} â€” ${element.description}`}
                    >
                      <Icon size={15} className={`theme-studio-element-icon ${isSelected ? 'text-accent-primary' : 'text-text-faint'}`} />
                      <span className="theme-studio-element-copy min-w-0">
                        <span className="block text-xs font-bold text-text-main">{element.label}</span>
                        <span className="theme-studio-element-description block text-[10px] text-text-faint">{element.description}</span>
                      </span>
                    </NemotoPanelRowButton>
                  );
                })}
              </section>
            ))}
          </nav>
        </NemotoPanel>
        )}

        <main className="theme-studio-preview-pane min-w-0 min-h-0 flex flex-col bg-app-bg">
          <NemotoPanelHeader className="theme-studio-preview-header border-b p-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-text-main">Live Preview</div>
              <div className="text-[10px] text-text-faint">Select an element on the left, or click it in the preview.</div>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Studio panels">
              <NemotoButton
                icon
                size="sm"
                variant={elementsPanelOpen ? 'default' : 'ghost'}
                aria-label={elementsPanelOpen ? 'Hide elements panel' : 'Show elements panel'}
                aria-pressed={elementsPanelOpen}
                title={elementsPanelOpen ? 'Hide elements panel' : 'Show elements panel'}
                onClick={() => setElementsPanelOpen(open => !open)}
              >
                <PanelLeft size={14} />
              </NemotoButton>
              <NemotoButton
                icon
                size="sm"
                variant={inspectorPanelOpen ? 'default' : 'ghost'}
                aria-label={inspectorPanelOpen ? 'Hide properties panel' : 'Show properties panel'}
                aria-pressed={inspectorPanelOpen}
                title={inspectorPanelOpen ? 'Hide properties panel' : 'Show properties panel'}
                onClick={() => setInspectorPanelOpen(open => !open)}
              >
                <SlidersHorizontal size={14} />
              </NemotoButton>
            </div>
          </NemotoPanelHeader>

          <div className="theme-studio-preview-canvas flex-1 min-h-0 p-5">
            <div className="theme-studio-preview-frame h-full min-w-0 overflow-hidden rounded-lg border border-app-border bg-app-surface shadow-sm" data-testid="theme-studio-preview-frame">
              <div
                style={previewStyles}
                data-theme={previewThemeId}
                data-theme-surface-style={draftPresentation.attributes['data-theme-surface-style']}
                data-theme-node-style={draftPresentation.attributes['data-theme-node-style']}
                className="h-full w-full"
              >
                {draftFontFaceCss && <style>{draftFontFaceCss}</style>}
                {renderPreviewScene()}
              </div>
            </div>
          </div>
        </main>

        {inspectorPanelOpen && (
        <NemotoPanel as="aside" className="theme-studio-inspector-panel nemoto-inspector-panel border-l flex flex-col min-h-0 overflow-hidden" data-testid="theme-studio-inspector-panel">
          <NemotoPanelHeader className="border-b p-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-accent-primary" />
              <h2 className="text-sm font-bold text-text-main truncate">{selectedElement.label}</h2>
            </div>
            <p className="mt-1 text-xs text-text-muted leading-relaxed">{selectedElement.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="theme-studio-token-meta rounded border border-app-border px-2 py-1 uppercase tracking-wider">
                Scene: {selectedElement.scene}
              </span>
              <span className="theme-studio-token-meta rounded border border-app-border px-2 py-1 uppercase tracking-wider">
                {selectedElement.id === 'branding' ? 'Brand properties' : selectedElement.id === 'recipes' ? '6 Core recipes' : `${selectedElement.sections.length} property groups`}
              </span>
              {selectedTheme && (
                <span className="theme-studio-token-meta rounded border border-app-border px-2 py-1 uppercase tracking-wider">
                  {tokenOverrideCount} token {tokenOverrideCount === 1 ? 'override' : 'overrides'}
                </span>
              )}
            </div>
          </NemotoPanelHeader>

          {selectedThemeId ? (
            <>
              <div className="border-b border-app-border p-4 space-y-3">
                <label htmlFor="theme-studio-name" className="block text-[10px] font-bold uppercase tracking-wider text-text-faint">Theme Name</label>
                <NemotoInput
                  id="theme-studio-name"
                  controlSize="sm"
                  value={themeName}
                  onChange={(event) => setThemeName(event.target.value)}
                  className="w-full text-sm"
                  placeholder="My Custom Theme"
                  disabled={isWorking}
                />
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Reset public theme tokens to baseline">
                  {THEME_PRESET_OPTIONS.map(preset => (
                    <NemotoButton
                      size="sm"
                      key={preset.id}
                      onClick={() => handleResetToPreset(preset.id)}
                      className="flex-col gap-1 py-2 text-[10px]"
                      title={`Use ${preset.label} art direction and reset public tokens`}
                      aria-pressed={draftBasePresetId === preset.id}
                      disabled={isWorking}
                    >
                      <span
                        className="h-4 w-8 rounded border border-app-border"
                        style={{ background: preset.tokens['--color-app-bg'] }}
                      />
                      {preset.label}
                    </NemotoButton>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5">
                {selectedElement.id === 'branding' ? renderBrandingInspector() : selectedElement.id === 'recipes' ? renderRecipeInspector() : selectedElement.sections.map(section => (
                  <section key={section.title} className="theme-studio-inspector-section space-y-3">
                    <div>
                      <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-main">{section.title}</h3>
                      {section.description && (
                        <p className="mt-1 text-[10px] leading-relaxed text-text-faint">{section.description}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      {section.tokens.map(renderTokenControl)}
                    </div>
                  </section>
                ))}
              </div>

              <NemotoDialogFooter className="border-t p-3 space-y-2">
                <div className="text-[10px] leading-relaxed text-text-faint" aria-live="polite">
                  {operation === 'save'
                    ? 'Saving the current draftâ€¦'
                    : operation === 'apply'
                      ? 'Saving and applying the themeâ€¦'
                      : hasUnsavedChanges
                        ? 'Unsaved changes are previewed locally.'
                        : activeThemeId === selectedThemeId
                          ? 'This saved theme is active in the app.'
                          : 'Save writes the draft. Apply saves and activates it.'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NemotoButton size="sm" onClick={handleSaveTheme} disabled={isWorking || !hasUnsavedChanges}>
                    <Save size={14} />
                    {operation === 'save' ? 'Savingâ€¦' : 'Save'}
                  </NemotoButton>
                  <NemotoButton
                    size="sm"
                    onClick={handleApplyTheme}
                    variant={activeThemeId === selectedThemeId ? 'default' : 'primary'}
                    disabled={isWorking || (activeThemeId === selectedThemeId && !hasUnsavedChanges)}
                  >
                    <Check size={14} />
                    {operation === 'apply'
                      ? 'Applyingâ€¦'
                      : activeThemeId === selectedThemeId && !hasUnsavedChanges
                        ? 'Active'
                        : activeThemeId === selectedThemeId
                          ? 'Apply changes'
                          : 'Apply'}
                  </NemotoButton>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <NemotoButton icon size="sm" onClick={handleDuplicateTheme} aria-label="Duplicate theme" title="Duplicate theme" disabled={isWorking}>
                    <Copy size={14} />
                  </NemotoButton>
                  <NemotoButton icon size="sm" onClick={handleExportJSON} aria-label="Download theme file" title="Download theme file" disabled={isWorking}>
                    <Download size={14} />
                  </NemotoButton>
                  <NemotoButton icon size="sm" onClick={handleCopyJSON} aria-label="Copy theme JSON" title="Copy theme JSON" disabled={isWorking}>
                    <FileJson size={14} />
                  </NemotoButton>
                  <NemotoButton icon size="sm" variant="danger" onClick={() => setDeleteConfirmOpen(true)} aria-label="Delete theme" title="Delete theme" disabled={isWorking}>
                    <Trash2 size={14} />
                  </NemotoButton>
                </div>
              </NemotoDialogFooter>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="nemoto-dialog-icon nemoto-dialog-icon-primary p-4 mb-4">
                <Palette size={32} />
              </div>
              <h3 className="text-sm font-bold text-text-main">Create a custom theme</h3>
              <p className="mt-2 text-xs text-text-muted leading-relaxed">
                Built-in baselines are preview-only. Create or import a theme to edit tokens and share the file.
              </p>
              <div className="mt-5 flex gap-2">
                <NemotoButton variant="primary" onClick={() => requestNavigation({ kind: 'create' })} className="text-sm" disabled={isWorking}>
                  <Plus size={14} />
                  Create
                </NemotoButton>
                <NemotoButton onClick={() => requestNavigation({ kind: 'import' })} className="text-sm" disabled={isWorking}>
                  <Upload size={14} />
                  Import
                </NemotoButton>
              </div>
            </div>
          )}
        </NemotoPanel>
        )}
      </div>

      {showCreateModal && (
        <NemotoDialog
          aria-labelledby="theme-create-title"
          onClose={() => setShowCreateModal(false)}
          panelClassName="w-full max-w-md overflow-hidden"
          rootClassName="z-[10050]"
        >
            <NemotoDialogHeader className="border-b p-5 flex items-center justify-between">
              <h3 id="theme-create-title" className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                <Palette size={16} className="text-accent-primary" />
                Create Theme
              </h3>
              <NemotoButton icon size="sm" variant="ghost" aria-label="Close create theme dialog" onClick={() => setShowCreateModal(false)} disabled={isWorking}>
                <X size={16} />
              </NemotoButton>
            </NemotoDialogHeader>
            <form onSubmit={handleCreateTheme} className="nemoto-dialog-body p-5 space-y-5">
              <div className="space-y-2">
                <label htmlFor="theme-create-name" className="text-xs font-bold uppercase text-text-faint">Theme Name</label>
                <NemotoInput
                  id="theme-create-name"
                  type="text"
                  required
                  value={newThemeName}
                  onChange={(event) => setNewThemeName(event.target.value)}
                  className="w-full px-3 py-2 text-sm"
                  placeholder="My Custom Theme"
                  autoFocus
                  disabled={isWorking}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-text-faint">Start From Baseline</label>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Theme baseline">
                  {THEME_PRESET_OPTIONS.map(preset => (
                    <NemotoChoiceCard
                      key={preset.id}
                      selected={newBasePreset === preset.id}
                      onClick={() => setNewBasePreset(preset.id)}
                      className="flex flex-col items-center gap-2 p-3 text-xs"
                      aria-pressed={newBasePreset === preset.id}
                      disabled={isWorking}
                    >
                      <span
                        className="h-6 w-12 rounded border border-app-border"
                        style={{ background: preset.tokens['--color-app-bg'] }}
                      />
                      {preset.label}
                    </NemotoChoiceCard>
                  ))}
                </div>
              </div>

              <NemotoDialogFooter className="-mx-5 -mb-5 mt-5 border-t p-4 flex justify-end gap-2">
                <NemotoButton onClick={() => setShowCreateModal(false)} className="text-sm" disabled={isWorking}>
                  Cancel
                </NemotoButton>
                <NemotoButton type="submit" variant="primary" className="text-sm" disabled={isWorking || !newThemeName.trim()}>
                  {operation === 'create' ? 'Creatingâ€¦' : 'Create'}
                  <ArrowRight size={14} />
                </NemotoButton>
              </NemotoDialogFooter>
            </form>
        </NemotoDialog>
      )}

      {showImportModal && (
        <NemotoDialog
          aria-labelledby="theme-import-title"
          onClose={() => { setShowImportModal(false); setImportError(null); }}
          panelClassName="w-full max-w-lg overflow-hidden"
          rootClassName="z-[10050]"
        >
            <NemotoDialogHeader className="border-b p-5 flex items-center justify-between">
              <h3 id="theme-import-title" className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                <Upload size={16} className="text-accent-primary" />
                Import Theme File
              </h3>
              <NemotoButton icon size="sm" variant="ghost" aria-label="Close import theme dialog" onClick={() => { setShowImportModal(false); setImportError(null); }} disabled={isWorking}>
                <X size={16} />
              </NemotoButton>
            </NemotoDialogHeader>
            <NemotoDialogBody className="p-5 space-y-4">
              <p className="text-xs text-text-muted">
                Paste exported Nemoto theme JSON, or choose a theme file from this device.
              </p>
              <NemotoButton
                onClick={() => fileInputRef.current?.click()}
                className="text-sm"
                disabled={isWorking}
              >
                <FileJson size={14} />
                Choose theme file
              </NemotoButton>
              {importError && (
                <div role="alert" className="rounded border border-accent-danger/50 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger">
                  {importError}
                </div>
              )}
              <NemotoTextarea
                aria-label="Theme JSON"
                value={jsonText}
                onChange={(event) => { setJsonText(event.target.value); setImportError(null); }}
                rows={10}
                className="w-full p-3 text-xs font-mono"
                disabled={isWorking}
                placeholder={`{\n  "schema": "axiom.theme",\n  "label": "My Brand Theme",\n  "tokens": {\n    "--color-app-bg": "#0f172a"\n  }\n}`}
              />
              <NemotoDialogFooter className="-mx-5 -mb-5 mt-5 border-t p-4 flex justify-end gap-2">
                <NemotoButton onClick={() => { setShowImportModal(false); setImportError(null); }} className="text-sm" disabled={isWorking}>
                  Cancel
                </NemotoButton>
                <NemotoButton variant="primary" onClick={handleImportText} className="text-sm" disabled={isWorking || !jsonText.trim()}>
                  <Check size={14} />
                  {operation === 'import' ? 'Importingâ€¦' : 'Import'}
                </NemotoButton>
              </NemotoDialogFooter>
            </NemotoDialogBody>
        </NemotoDialog>
      )}

      <ConfirmationModal
        isOpen={pendingThemeImport !== null}
        onClose={() => setPendingThemeImport(null)}
        onConfirm={() => { void confirmReplaceImportedTheme(); }}
        title="Replace Installed Theme?"
        message={pendingThemeImport
          ? `A theme with the stable ID "${pendingThemeImport.theme.id}" is already installed. Replacing it overwrites that local theme file and activates the imported version.`
          : ''}
        confirmLabel="Replace and Import"
        cancelLabel="Keep Installed Theme"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDeleteTheme}
        title="Delete Theme"
        message="Are you sure you want to delete this theme? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
      <ConfirmationModal
        isOpen={discardConfirmOpen}
        onClose={() => {
          setDiscardConfirmOpen(false);
          setPendingNavigation(null);
        }}
        onConfirm={confirmDiscardChanges}
        title="Discard Unsaved Changes?"
        message={pendingNavigation?.kind === 'select-theme' || pendingNavigation?.kind === 'select-baseline'
          ? 'Switching themes will discard the current unsaved draft.'
          : 'Continuing will discard the current unsaved draft.'}
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
      />
      <ConfirmationModal
        isOpen={closeConfirmOpen}
        onClose={() => setCloseConfirmOpen(false)}
        onConfirm={() => { void confirmWindowClose(); }}
        title="Close Without Saving?"
        message="Theme Studio has unsaved changes. Closing the window will discard the current draft."
        confirmLabel="Close Without Saving"
        cancelLabel="Keep Editing"
        variant="warning"
      />
    </div>
  );
};

export default ThemeBuilder;
