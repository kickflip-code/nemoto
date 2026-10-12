import React, { useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    CheckCircle,
    ClipboardPaste,
    FileJson,
    FileSpreadsheet,
    FolderOpen,
    Layers3,
    Upload,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { validateImport, type ValidationResult } from '../../lib/import/validator';
import {
    RESOURCE_IMPORT_LIMITS,
    buildResourceImportPlan,
    createDefaultResourceMapping,
    parseDelimitedResourceText,
    parseJsonResourceText,
    type ResourceImportMapping,
    type ResourceImportSource,
} from '../../lib/import/resourceImport';
import { parseResourceWorkbook } from '../../lib/import/resourceXlsx';
import type { ImportedPortfolio } from '../../types';
import { generateId } from '../../lib/id';
import { importVisioPortfolio } from '../../export/VisioImportService';
import NemotoDocumentMetadata from './NemotoDocumentMetadata';
import { useImportFileDrop } from './useImportFileDrop';
import {
    NemotoButton,
    NemotoChoiceCard,
    NemotoDialog,
    NemotoInput,
    NemotoSelect,
    NemotoTextarea,
} from '../ui';

interface ImportWizardModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type Step = 'choose' | 'resource-source' | 'mapping' | 'review' | 'reference-source' | 'reference-analysis';
export const MAX_TEXT_IMPORT_BYTES = RESOURCE_IMPORT_LIMITS.maxSourceBytes;
export const RESOURCE_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,.json';
export const REFERENCE_FILE_ACCEPT = '.nemoto,.nemoto-process,.axiom,.ax,.json,.vsdx';
const RESOURCE_DIALOG_FILTERS = [{ name: 'Resource data', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'json'] }];
const REFERENCE_DIALOG_FILTERS = [{ name: 'Nemoto portfolio or process', extensions: ['nemoto', 'nemoto-process', 'axiom', 'ax', 'json', 'vsdx'] }];

const fileNameFromPath = (path: string): string => path.split(/[\\/]/).pop() || 'imported-file';

const mimeTypeForFile = (name: string): string => {
    const extension = name.toLocaleLowerCase().split('.').pop() || '';
    if (extension === 'nemoto' || extension === 'nemoto-process' || extension === 'json' || extension === 'axiom' || extension === 'ax') return 'application/json';
    if (extension === 'csv') return 'text/csv';
    if (extension === 'tsv') return 'text/tab-separated-values';
    if (extension === 'txt') return 'text/plain';
    if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (extension === 'vsdx') return 'application/vnd.ms-visio.drawing';
    return 'application/octet-stream';
};

const stepNumber = (step: Step): number => {
    if (step === 'mapping') return 2;
    if (step === 'review') return 3;
    return 1;
};

const valueLabel = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
};

export default function ImportWizardModal({ isOpen, onClose }: ImportWizardModalProps) {
    const [step, setStep] = useState<Step>('choose');
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
    const [sourceName, setSourceName] = useState('');
    const [resourceSource, setResourceSource] = useState<ResourceImportSource | null>(null);
    const [activeSheetId, setActiveSheetId] = useState('');
    const [mapping, setMapping] = useState<ResourceImportMapping | null>(null);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [importError, setImportError] = useState('');
    const [busy, setBusy] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);
    const isDesktopRuntime = isTauri();
    const portfolio = usePortfolioStore(state => state.portfolio);
    const addImportedPortfolio = usePortfolioStore(state => state.addImportedPortfolio);
    const importResources = usePortfolioStore(state => state.importResources);

    React.useEffect(() => {
        if (!isOpen) return;
        setStep('choose');
        setValidationResult(null);
        setSourceName('');
        setResourceSource(null);
        setActiveSheetId('');
        setMapping(null);
        setPasteOpen(false);
        setPasteText('');
        setImportError('');
        setBusy(false);
    }, [isOpen]);

    React.useEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
    }, [step]);

    const activeSheet = useMemo(() => (
        resourceSource?.sheets.find(sheet => sheet.id === activeSheetId)
        || resourceSource?.sheets[0]
    ), [activeSheetId, resourceSource]);

    const planResult = useMemo(() => {
        if (!activeSheet || !mapping) return { plan: null, error: '' };
        try {
            return {
                plan: buildResourceImportPlan(activeSheet, mapping, portfolio),
                error: '',
            };
        } catch (error) {
            return {
                plan: null,
                error: error instanceof Error ? error.message : 'The resource mapping is incomplete.',
            };
        }
    }, [activeSheet, mapping, portfolio]);

    const startResourceImport = (source: ResourceImportSource) => {
        const sheet = source.sheets[0];
        setResourceSource(source);
        setSourceName(source.name);
        setActiveSheetId(sheet.id);
        setMapping(createDefaultResourceMapping(sheet));
        setImportError('');
        setStep('mapping');
    };

    const showReferenceAnalysis = (result: ValidationResult, name: string) => {
        setSourceName(name);
        setValidationResult(result);
        setStep('reference-analysis');
    };

    const assertTextFileSize = (file: File) => {
        if (file.size > MAX_TEXT_IMPORT_BYTES) {
            throw new Error('This file is larger than the 50 MB import limit.');
        }
    };

    const beginFileRead = (file: File) => {
        setBusy(true);
        setImportError('');
        setSourceName(file.name);
    };

    const failFileRead = (error: unknown) => {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : 'Failed to read file';
        setImportError(message);
        toast.error(message);
    };

    const handleResourceFile = async (file: File) => {
        const extension = file.name.toLocaleLowerCase().split('.').pop() || '';
        beginFileRead(file);
        try {
            if (extension === 'xlsx') {
                startResourceImport(await parseResourceWorkbook(file));
                return;
            }
            if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
                assertTextFileSize(file);
                const text = await file.text();
                startResourceImport(parseDelimitedResourceText(text, {
                    name: file.name,
                    ...(extension === 'tsv' ? { delimiter: '\t' as const, format: 'tsv' as const } : {}),
                }));
                return;
            }
            assertTextFileSize(file);
            const text = await file.text();
            if (extension === 'json') {
                startResourceImport(parseJsonResourceText(text, file.name));
                return;
            }
            throw new Error('Choose a CSV, TSV, Excel, or resource JSON file.');
        } catch (error) {
            failFileRead(error);
        } finally {
            setBusy(false);
        }
    };

    const handleReferenceFile = async (file: File) => {
        const extension = file.name.toLocaleLowerCase().split('.').pop() || '';
        beginFileRead(file);
        try {
            if (extension === 'vsdx') {
                const imported = await importVisioPortfolio(file);
                showReferenceAnalysis({ success: true, data: imported }, file.name);
                return;
            }
            if (!['nemoto', 'nemoto-process', 'axiom', 'ax', 'json'].includes(extension)) {
                throw new Error('Choose a Nemoto portfolio, process fragment, JSON, or Visio file.');
            }
            assertTextFileSize(file);
            showReferenceAnalysis(await validateImport(await file.text()), file.name);
        } catch (error) {
            failFileRead(error);
        } finally {
            setBusy(false);
        }
    };

    const handleFileUpload = async (
        event: React.ChangeEvent<HTMLInputElement>,
        kind: 'resource' | 'reference',
    ) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        try {
            await (kind === 'resource' ? handleResourceFile(file) : handleReferenceFile(file));
        } finally {
            // Keep the native file handle alive until asynchronous reading has finished.
            // Clearing afterwards still lets the same file be selected again.
            input.value = '';
        }
    };

    const prepareFileInput = (event: React.MouseEvent<HTMLInputElement>) => {
        // Browsers do not emit change when the same path is chosen twice unless the
        // previous value is cleared before opening the picker.
        event.currentTarget.value = '';
    };

    const handleNativePath = async (selected: string, kind: 'resource' | 'reference') => {
        if (busy) return;
        setBusy(true);
        setImportError('');
        try {
            const name = fileNameFromPath(selected);
            setSourceName(name);
            const metadata = await stat(selected);
            const extension = name.toLocaleLowerCase().split('.').pop() || '';
            if (extension !== 'vsdx' && metadata.size > MAX_TEXT_IMPORT_BYTES) {
                throw new Error('This file is larger than the 50 MB import limit.');
            }
            const bytes = await readFile(selected);
            const file = new File([bytes], name, { type: mimeTypeForFile(name) });
            await (kind === 'resource' ? handleResourceFile(file) : handleReferenceFile(file));
        } catch (error) {
            failFileRead(error);
        } finally {
            setBusy(false);
        }
    };

    const handleNativeFilePick = async (kind: 'resource' | 'reference') => {
        if (busy) return;
        setBusy(true);
        setImportError('');
        try {
            const selected = await openNativeDialog({
                multiple: false,
                directory: false,
                filters: kind === 'resource' ? RESOURCE_DIALOG_FILTERS : REFERENCE_DIALOG_FILTERS,
            });
            if (typeof selected === 'string') await handleNativePath(selected, kind);
        } catch (error) {
            failFileRead(error);
        } finally {
            setBusy(false);
        }
    };

    const dropZone = useImportFileDrop({
        enabled: isOpen && (step === 'resource-source' || step === 'reference-source'),
        desktop: isDesktopRuntime,
        busy,
        onFile: step === 'resource-source' ? handleResourceFile : handleReferenceFile,
        onPath: path => handleNativePath(path, step === 'resource-source' ? 'resource' : 'reference'),
        onError: failFileRead,
    });

    const returnToResourceSource = () => {
        setResourceSource(null);
        setActiveSheetId('');
        setMapping(null);
        setSourceName('');
        setPasteOpen(false);
        setPasteText('');
        setImportError('');
        setStep('resource-source');
    };

    const handlePaste = () => {
        try {
            startResourceImport(parseDelimitedResourceText(pasteText, {
                name: 'Pasted table',
                format: 'clipboard',
            }));
        } catch (error) {
            setImportError(error instanceof Error ? error.message : 'The pasted table could not be read.');
        }
    };

    const selectSheet = (sheetId: string) => {
        const sheet = resourceSource?.sheets.find(candidate => candidate.id === sheetId);
        if (!sheet) return;
        setActiveSheetId(sheetId);
        setMapping(createDefaultResourceMapping(sheet, mapping?.categoryId || ''));
    };

    const selectNameColumn = (columnIndex: number) => {
        setMapping(current => current ? {
            ...current,
            nameColumnIndex: columnIndex,
            properties: current.properties.map(property => {
                if (property.columnIndex === columnIndex) return { ...property, enabled: false };
                if (property.columnIndex === current.nameColumnIndex) return { ...property, enabled: true };
                return property;
            }),
        } : current);
    };

    const updateProperty = (
        columnIndex: number,
        updates: Partial<ResourceImportMapping['properties'][number]>,
    ) => {
        setMapping(current => current ? {
            ...current,
            properties: current.properties.map(property => (
                property.columnIndex === columnIndex ? { ...property, ...updates } : property
            )),
        } : current);
    };

    const handleImportAsReference = () => {
        if (!validationResult?.data) return;
        const imported: ImportedPortfolio = {
            id: generateId('import'),
            sourceName,
            importedAt: new Date().toISOString(),
            data: validationResult.data,
            isReadOnly: true,
        };
        addImportedPortfolio(imported);
        toast.success(`Opened “${sourceName}” as a temporary reference`);
        onClose();
    };

    const handleResourceImport = () => {
        if (!planResult.plan || planResult.plan.assets.length === 0) return;
        try {
            importResources(planResult.plan.assets);
            toast.success(`Imported ${planResult.plan.assets.length} resource${planResult.plan.assets.length === 1 ? '' : 's'}`);
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The resources could not be imported.');
        }
    };

    const currentStep = stepNumber(step);

    if (!isOpen) return null;

    return (
        <NemotoDialog
            aria-labelledby="import-dialog-title"
            onClose={onClose}
            panelClassName="w-full max-w-[820px] flex flex-col max-h-[88vh] overflow-hidden"
        >
            <header className="nemoto-dialog-header border-b px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <h2 id="import-dialog-title" className="flex items-center gap-2 text-sm font-semibold text-text-main">
                            <Upload size={16} /> Import
                        </h2>
                        {(['resource-source', 'mapping', 'review'] as Step[]).includes(step) && (
                            <div className="mt-2 flex items-center gap-2 text-[10px] font-medium text-text-faint" aria-label={`Step ${currentStep} of 3`}>
                                {['Source', 'Map fields', 'Review'].map((label, index) => (
                                    <React.Fragment key={label}>
                                        {index > 0 && <span aria-hidden="true" className="h-px w-5 bg-app-border" />}
                                        <span className={index + 1 <= currentStep ? 'text-text-main' : undefined}>
                                            {index + 1}. {label}
                                        </span>
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>
                    <NemotoButton icon size="sm" variant="ghost" aria-label="Close import dialog" onClick={onClose}>
                        <X size={16} />
                    </NemotoButton>
                </div>
            </header>

            <div ref={bodyRef} className="nemoto-dialog-body min-h-0 flex-1 overflow-y-auto p-5">
                {step === 'choose' && (
                    <div className="mx-auto max-w-[680px] py-4">
                        <div className="mb-5 text-center">
                            <h3 className="text-base font-semibold text-text-main">What would you like to import?</h3>
                            <p className="mt-1 text-xs text-text-muted">Choose an import type to see only the options that belong to it.</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <NemotoChoiceCard
                                aria-label="Import resources"
                                selected={false}
                                className="flex min-h-[170px] flex-col items-start p-5 text-left"
                                onClick={() => {
                                    setImportError('');
                                    setStep('resource-source');
                                }}
                            >
                                <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-app-border bg-app-surface text-text-main">
                                    <FileSpreadsheet size={18} />
                                </span>
                                <span className="text-sm font-semibold text-text-main">Resources</span>
                                <span className="mt-1 text-xs leading-relaxed text-text-muted">Create resources from a spreadsheet, JSON, or a pasted table.</span>
                                <span className="mt-auto pt-4 text-[10px] text-text-faint">CSV · TSV · XLSX · JSON · Paste</span>
                            </NemotoChoiceCard>
                            <NemotoChoiceCard
                                aria-label="Open portfolio or process"
                                selected={false}
                                className="flex min-h-[170px] flex-col items-start p-5 text-left"
                                onClick={() => {
                                    setImportError('');
                                    setStep('reference-source');
                                }}
                            >
                                <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-app-border bg-app-surface text-text-main">
                                    <FolderOpen size={18} />
                                </span>
                                <span className="text-sm font-semibold text-text-main">Portfolio or process</span>
                                <span className="mt-1 text-xs leading-relaxed text-text-muted">Open a Nemoto portfolio, process fragment, or Visio file as a temporary reference.</span>
                                <span className="mt-auto pt-4 text-[10px] text-text-faint">NEMOTO · NEMOTO-PROCESS · JSON · VSDX</span>
                            </NemotoChoiceCard>
                        </div>
                    </div>
                )}

                {step === 'resource-source' && (
                    <div className="mx-auto max-w-[650px] space-y-4">
                        <div {...dropZone} className="relative flex min-h-[210px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-app-border bg-app-surface/50 p-8 text-center transition-colors hover:bg-app-surface">
                            {isDesktopRuntime ? (
                                <button
                                    type="button"
                                    aria-label="Choose a resource spreadsheet or JSON file"
                                    disabled={busy}
                                    onClick={() => void handleNativeFilePick('resource')}
                                    className="absolute inset-0 z-10 cursor-pointer rounded-lg opacity-0 disabled:cursor-wait"
                                />
                            ) : (
                                <input
                                    type="file"
                                    aria-label="Choose a resource spreadsheet or JSON file"
                                    accept={RESOURCE_FILE_ACCEPT}
                                    disabled={busy}
                                    onClick={prepareFileInput}
                                    onChange={event => void handleFileUpload(event, 'resource')}
                                    className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
                                />
                            )}
                            <FileSpreadsheet size={42} className="mb-4 text-text-muted" />
                            <p className="text-sm font-medium text-text-main">
                                {busy ? 'Reading file…' : 'Drop a file here or choose one'}
                            </p>
                            <p className="mt-2 text-xs text-text-faint">CSV, TSV, Excel, or resource JSON</p>
                        </div>

                        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-faint">
                            <span className="h-px flex-1 bg-app-border" /> or <span className="h-px flex-1 bg-app-border" />
                        </div>

                        {!pasteOpen ? (
                            <NemotoButton className="mx-auto flex" onClick={() => setPasteOpen(true)}>
                                <ClipboardPaste size={14} /> Paste a table
                            </NemotoButton>
                        ) : (
                            <div className="nemoto-dialog-panel space-y-3 p-4">
                                <div>
                                    <label htmlFor="resource-import-paste" className="text-xs font-medium text-text-main">Paste rows and columns</label>
                                    <p className="mt-1 text-[10px] text-text-faint">The first row should contain column names.</p>
                                </div>
                                <NemotoTextarea
                                    id="resource-import-paste"
                                    aria-label="Pasted resource table"
                                    value={pasteText}
                                    onChange={event => setPasteText(event.target.value)}
                                    className="min-h-28 w-full resize-y font-mono text-xs"
                                    placeholder={'Resource name\tOwner\tLocation\nLaptop\tSupport\tStockholm'}
                                />
                                <div className="flex justify-end gap-2">
                                    <NemotoButton size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>Hide</NemotoButton>
                                    <NemotoButton size="sm" variant="primary" disabled={!pasteText.trim()} onClick={handlePaste}>Use pasted table</NemotoButton>
                                </div>
                            </div>
                        )}

                        {importError && (
                            <div role="alert" className="flex items-start gap-2 rounded-md border border-accent-danger/20 bg-accent-danger/10 p-3 text-xs text-text-muted">
                                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-accent-danger" />
                                <span>{importError}</span>
                            </div>
                        )}
                    </div>
                )}

                {step === 'reference-source' && (
                    <div className="mx-auto max-w-[650px] space-y-4">
                        <div>
                            <h3 className="text-sm font-semibold text-text-main">Portfolio or process</h3>
                            <p className="mt-1 text-xs text-text-muted">Open external Nemoto content as a temporary, read-only reference.</p>
                        </div>
                        <div {...dropZone} className="relative flex min-h-[230px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-app-border bg-app-surface/50 p-8 text-center transition-colors hover:bg-app-surface">
                            {isDesktopRuntime ? (
                                <button
                                    type="button"
                                    aria-label="Choose a Nemoto portfolio, process fragment, JSON, or Visio file"
                                    disabled={busy}
                                    onClick={() => void handleNativeFilePick('reference')}
                                    className="absolute inset-0 z-10 cursor-pointer rounded-lg opacity-0 disabled:cursor-wait"
                                />
                            ) : (
                                <input
                                    type="file"
                                    aria-label="Choose a Nemoto portfolio, process fragment, JSON, or Visio file"
                                    accept={REFERENCE_FILE_ACCEPT}
                                    disabled={busy}
                                    onClick={prepareFileInput}
                                    onChange={event => void handleFileUpload(event, 'reference')}
                                    className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
                                />
                            )}
                            <FileJson size={42} className="mb-4 text-text-muted" />
                            <p className="text-sm font-medium text-text-main">
                                {busy ? 'Reading file…' : 'Drop a Nemoto or Visio file here'}
                            </p>
                            <p className="mt-2 text-xs text-text-faint">.nemoto, .nemoto-process, portfolio JSON, or VSDX</p>
                            <p className="mt-1 text-[10px] text-text-faint">The source is validated before it is opened.</p>
                        </div>
                        {importError && (
                            <div role="alert" className="flex items-start gap-2 rounded-md border border-accent-danger/20 bg-accent-danger/10 p-3 text-xs text-text-muted">
                                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-accent-danger" />
                                <span>{importError}</span>
                            </div>
                        )}
                    </div>
                )}

                {step === 'mapping' && activeSheet && mapping && resourceSource && (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs font-medium text-text-main">
                                    <FileSpreadsheet size={14} />
                                    <span className="truncate">{resourceSource.name}</span>
                                </div>
                                <p className="mt-1 text-[10px] text-text-faint">Each row will become one resource.</p>
                            </div>
                            {resourceSource.sheets.length > 1 && (
                                <div>
                                    <label htmlFor="resource-import-sheet" className="mb-1 block text-[10px] text-text-faint">Worksheet</label>
                                    <NemotoSelect
                                        id="resource-import-sheet"
                                        controlSize="sm"
                                        value={activeSheet.id}
                                        onChange={event => selectSheet(event.target.value)}
                                    >
                                        {resourceSource.sheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
                                    </NemotoSelect>
                                </div>
                            )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="nemoto-dialog-panel p-4">
                                <label htmlFor="resource-name-column" className="text-xs font-medium text-text-main">Resource name</label>
                                <p className="mb-3 mt-1 text-[10px] text-text-faint">Choose the column that identifies each resource.</p>
                                <NemotoSelect
                                    id="resource-name-column"
                                    controlSize="sm"
                                    className="w-full"
                                    value={mapping.nameColumnIndex}
                                    onChange={event => selectNameColumn(Number(event.target.value))}
                                >
                                    {activeSheet.headers.map((header, index) => <option key={header} value={index}>{header}</option>)}
                                </NemotoSelect>
                            </div>
                            <div className="nemoto-dialog-panel p-4">
                                <label htmlFor="resource-category" className="text-xs font-medium text-text-main">Category</label>
                                <p className="mb-3 mt-1 text-[10px] text-text-faint">Applied to every resource in this import.</p>
                                <NemotoSelect
                                    id="resource-category"
                                    controlSize="sm"
                                    className="w-full"
                                    value={mapping.categoryId}
                                    onChange={event => setMapping({ ...mapping, categoryId: event.target.value })}
                                >
                                    <option value="">Choose category…</option>
                                    {portfolio.assetCategories.map(category => (
                                        <option key={category.id} value={category.id}>{category.label}</option>
                                    ))}
                                </NemotoSelect>
                                {portfolio.assetCategories.length === 0 && (
                                    <p className="mt-2 text-[10px] text-text-faint">Create a resource category in Portfolio before importing.</p>
                                )}
                            </div>
                        </div>

                        <section aria-labelledby="resource-properties-title" className="nemoto-dialog-panel overflow-hidden">
                            <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
                                <div>
                                    <h3 id="resource-properties-title" className="text-xs font-medium text-text-main">Properties</h3>
                                    <p className="mt-1 text-[10px] text-text-faint">Keep the useful columns and adjust their names or types.</p>
                                </div>
                                <span className="text-[10px] tabular-nums text-text-faint">
                                    {mapping.properties.filter(property => property.enabled).length} selected
                                </span>
                            </div>
                            <div className="max-h-[270px] overflow-y-auto">
                                {mapping.properties.map(property => {
                                    const header = activeSheet.headers[property.columnIndex];
                                    const isName = property.columnIndex === mapping.nameColumnIndex;
                                    return (
                                        <div key={property.columnIndex} className="grid grid-cols-[28px_minmax(100px,1fr)_minmax(120px,1fr)_105px] items-center gap-2 border-t border-app-border/40 px-4 py-2 first:border-t-0">
                                            <input
                                                type="checkbox"
                                                aria-label={`Import ${header} as a property`}
                                                checked={property.enabled && !isName}
                                                disabled={isName}
                                                onChange={event => updateProperty(property.columnIndex, { enabled: event.target.checked })}
                                                className="h-3.5 w-3.5 accent-accent-primary"
                                            />
                                            <span className="truncate text-xs text-text-muted" title={header}>{header}</span>
                                            <NemotoInput
                                                controlSize="xs"
                                                aria-label={`Property name for ${header}`}
                                                value={property.propertyName}
                                                disabled={!property.enabled || isName}
                                                onChange={event => updateProperty(property.columnIndex, { propertyName: event.target.value })}
                                            />
                                            <NemotoSelect
                                                controlSize="xs"
                                                aria-label={`Property type for ${header}`}
                                                value={property.valueType}
                                                disabled={!property.enabled || isName}
                                                onChange={event => updateProperty(property.columnIndex, {
                                                    valueType: event.target.value as typeof property.valueType,
                                                })}
                                            >
                                                <option value="auto">Auto</option>
                                                <option value="text">Text</option>
                                                <option value="number">Number</option>
                                                <option value="boolean">Boolean</option>
                                                <option value="date">Date</option>
                                            </NemotoSelect>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <section aria-labelledby="resource-preview-title">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 id="resource-preview-title" className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Source preview</h3>
                                <span className="text-[10px] text-text-faint">{activeSheet.rows.length} rows</span>
                            </div>
                            <div className="overflow-x-auto rounded-md border border-app-border">
                                <table className="min-w-full text-left text-[10px]">
                                    <thead className="bg-app-surface text-text-faint">
                                        <tr>{activeSheet.headers.map(header => <th key={header} className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {activeSheet.rows.slice(0, 4).map((row, rowIndex) => (
                                            <tr key={rowIndex} className="border-t border-app-border/50 text-text-muted">
                                                {activeSheet.headers.map((header, columnIndex) => (
                                                    <td key={header} className="max-w-48 truncate whitespace-nowrap px-3 py-2">{valueLabel(row[columnIndex])}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                )}

                {step === 'review' && activeSheet && mapping && planResult.plan && (
                    <div className="space-y-5">
                        <div>
                            <h3 className="text-base font-semibold text-text-main">Ready to import</h3>
                            <p className="mt-1 text-xs text-text-muted">Review the result before Nemoto changes the portfolio.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div className="nemoto-dialog-panel p-3">
                                <div className="text-xl font-semibold tabular-nums text-text-main">{planResult.plan.assets.length}</div>
                                <div className="mt-1 text-[10px] text-text-faint">Resources</div>
                            </div>
                            <div className="nemoto-dialog-panel p-3">
                                <div className="text-xl font-semibold tabular-nums text-text-main">{mapping.properties.filter(property => property.enabled).length}</div>
                                <div className="mt-1 text-[10px] text-text-faint">Properties</div>
                            </div>
                            <div className="nemoto-dialog-panel p-3">
                                <div className="text-xl font-semibold tabular-nums text-text-main">{planResult.plan.duplicateRows}</div>
                                <div className="mt-1 text-[10px] text-text-faint">Duplicates skipped</div>
                            </div>
                            <div className="nemoto-dialog-panel p-3">
                                <div className="text-xl font-semibold tabular-nums text-text-main">{planResult.plan.emptyNameRows}</div>
                                <div className="mt-1 text-[10px] text-text-faint">Unnamed rows skipped</div>
                            </div>
                        </div>

                        <div className="nemoto-dialog-panel flex flex-wrap items-center justify-between gap-3 p-4">
                            <div>
                                <label htmlFor="resource-duplicate-strategy" className="text-xs font-medium text-text-main">If a resource already exists</label>
                                <p className="mt-1 text-[10px] text-text-faint">Resources are compared by name and category.</p>
                            </div>
                            <NemotoSelect
                                id="resource-duplicate-strategy"
                                controlSize="sm"
                                value={mapping.duplicateStrategy}
                                onChange={event => setMapping({
                                    ...mapping,
                                    duplicateStrategy: event.target.value as ResourceImportMapping['duplicateStrategy'],
                                })}
                            >
                                <option value="skip">Skip existing</option>
                                <option value="create">Create another</option>
                            </NemotoSelect>
                        </div>

                        {(planResult.plan.invalidValues > 0 || planResult.plan.emptyNameRows > 0) && (
                            <div className="flex items-start gap-3 rounded-md border border-app-border bg-app-surface/50 p-3 text-xs text-text-muted">
                                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-text-faint" />
                                <div>
                                    {planResult.plan.emptyNameRows > 0 && <p>{planResult.plan.emptyNameRows} row(s) without a name will be skipped.</p>}
                                    {planResult.plan.invalidValues > 0 && <p>{planResult.plan.invalidValues} value(s) could not be converted and will be left empty.</p>}
                                </div>
                            </div>
                        )}

                        <section aria-labelledby="resource-result-preview">
                            <h3 id="resource-result-preview" className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">Resource preview</h3>
                            <div className="overflow-hidden rounded-md border border-app-border">
                                {planResult.plan.assets.slice(0, 8).map(asset => (
                                    <div key={asset.id} className="flex items-center justify-between gap-4 border-t border-app-border/50 px-3 py-2 first:border-t-0">
                                        <span className="truncate text-xs text-text-main">{asset.name}</span>
                                        <span className="shrink-0 text-[10px] text-text-faint">
                                            {Object.keys(asset.metadata || {}).length} properties
                                        </span>
                                    </div>
                                ))}
                                {planResult.plan.assets.length === 0 && (
                                    <div className="p-5 text-center text-xs text-text-faint">No new resources to import.</div>
                                )}
                                {planResult.plan.assets.length > 8 && (
                                    <div className="border-t border-app-border/50 px-3 py-2 text-center text-[10px] text-text-faint">
                                        and {planResult.plan.assets.length - 8} more
                                    </div>
                                )}
                            </div>
                        </section>

                        <div className="flex items-start gap-3 rounded-md border border-accent-success/20 bg-accent-success/10 p-3">
                            <CheckCircle size={16} className="mt-0.5 shrink-0 text-accent-success" />
                            <p className="text-xs leading-relaxed text-text-muted">The resources will be added together as one portfolio change. Existing resources are not modified.</p>
                        </div>
                    </div>
                )}

                {step === 'review' && planResult.error && (
                    <div role="alert" className="flex items-start gap-3 rounded-md border border-accent-danger/20 bg-accent-danger/10 p-4">
                        <AlertTriangle size={18} className="mt-0.5 text-accent-danger" />
                        <div>
                            <h3 className="text-sm font-medium text-text-main">Review the field mapping</h3>
                            <p className="mt-1 text-xs text-text-muted">{planResult.error}</p>
                        </div>
                    </div>
                )}

                {step === 'reference-analysis' && validationResult && (
                    <div className="space-y-4">
                        {validationResult.success ? (
                            <div className="flex items-start gap-3 rounded-lg border border-accent-success/20 bg-accent-success/10 p-4">
                                <CheckCircle size={20} className="mt-0.5 text-accent-success" />
                                <div>
                                    <h3 className="text-sm font-medium text-accent-success">Validation successful</h3>
                                    <p className="mt-1 text-xs text-text-muted">Ready to open <strong>{sourceName}</strong>.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-3 rounded-lg border border-accent-danger/20 bg-accent-danger/10 p-4">
                                <AlertTriangle size={20} className="mt-0.5 text-accent-danger" />
                                <div className="flex-1">
                                    <h3 className="text-sm font-medium text-accent-danger">Validation failed</h3>
                                    <p className="mt-1 text-xs text-text-muted">{validationResult.error}</p>
                                    <div className="mt-3 space-y-2">
                                        <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-text-faint">Problem checklist</div>
                                        <div className="nemoto-dialog-panel overflow-hidden">
                                            {(validationResult.issues || []).map((issue: any, index: number) => {
                                                const path = issue.path?.join(' → ') || 'Root';
                                                const friendlyPath = path
                                                    .replace(/processes → (\d+)/g, (_: string, item: string) => `Process #${Number(item) + 1}`)
                                                    .replace(/assets → (\d+)/g, (_: string, item: string) => `Resource #${Number(item) + 1}`)
                                                    .replace(/journal → entries → (\d+)/g, (_: string, item: string) => `Note #${Number(item) + 1}`);
                                                return (
                                                    <div key={index} className="flex items-start gap-2 border-t border-app-border/20 p-2 first:border-t-0">
                                                        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-danger" />
                                                        <div>
                                                            <div className="font-mono text-[10px] uppercase text-text-faint">{friendlyPath}</div>
                                                            <div className="mt-0.5 text-xs text-text-main">{issue.message}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {(!validationResult.issues || validationResult.issues.length === 0) && (
                                                <div className="p-3 text-center text-xs italic text-text-faint">No specific issue details available.</div>
                                            )}
                                        </div>
                                    </div>
                                    <NemotoButton
                                        size="sm"
                                        className="mt-3"
                                        onClick={() => {
                                            const errorText = JSON.stringify({
                                                error: validationResult.error,
                                                issues: validationResult.issues,
                                            }, null, 2);
                                            void navigator.clipboard.writeText(errorText);
                                            toast.success('Error details copied to clipboard');
                                        }}
                                    >
                                        <Upload size={12} className="rotate-180" /> Copy error
                                    </NemotoButton>
                                </div>
                            </div>
                        )}

                        {validationResult.success && validationResult.data && (
                            <>
                                {validationResult.kind
                                    && validationResult.sourceSchemaVersion !== undefined
                                    && validationResult.migration && (
                                    <NemotoDocumentMetadata
                                        kind={validationResult.kind}
                                        sourceSchemaVersion={validationResult.sourceSchemaVersion}
                                        targetSchemaVersion={validationResult.migration.targetSchemaVersion}
                                        sourceAppVersion={validationResult.sourceAppVersion}
                                        sourceTimestamp={validationResult.sourceTimestamp}
                                        wasWrapped={validationResult.wasWrapped ?? false}
                                    />
                                )}
                                {validationResult.integrity && validationResult.integrity.issues.length > 0 && (
                                    <div className="rounded-lg border border-accent-warning/20 bg-accent-warning/10 p-3 text-xs text-text-muted">
                                        The file is readable, but contains {validationResult.integrity.errors.length} reference or ID error(s) and {validationResult.integrity.warnings.length} warning(s). Existing IDs were preserved.
                                    </div>
                                )}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="rounded border border-app-border bg-app-surface p-3">
                                        <div className="text-2xl font-bold text-text-main">{(validationResult.data.processes || []).length}</div>
                                        <div className="text-xs text-text-faint">Processes</div>
                                    </div>
                                    <div className="rounded border border-app-border bg-app-surface p-3">
                                        <div className="text-2xl font-bold text-text-main">{(validationResult.data.assets || []).length}</div>
                                        <div className="text-xs text-text-faint">Resources</div>
                                    </div>
                                    <div className="rounded border border-app-border bg-app-surface p-3">
                                        <div className="text-2xl font-bold text-text-main">{(validationResult.data.journal?.entries || []).length}</div>
                                        <div className="text-xs text-text-faint">Notes</div>
                                    </div>
                                </div>
                                <div className="rounded border border-app-border bg-app-surface p-3 text-xs leading-relaxed text-text-muted">
                                    This opens a temporary, read-only reference. It remains available until you merge or discard it, or until Nemoto closes. To replace your complete portfolio instead, use <strong>Settings → Data &amp; Backup → Restore</strong>.
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            <footer className="nemoto-dialog-footer flex items-center justify-between gap-3 border-t p-4">
                <div>
                    {step !== 'choose' && (
                        <NemotoButton
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                setImportError('');
                                if (step === 'review') setStep('mapping');
                                else if (step === 'mapping') returnToResourceSource();
                                else if (step === 'reference-analysis') setStep('reference-source');
                                else setStep('choose');
                            }}
                        >
                            <ArrowLeft size={13} /> Back
                        </NemotoButton>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <NemotoButton size="sm" onClick={onClose}>Cancel</NemotoButton>
                    {step === 'mapping' && (
                        <NemotoButton
                            size="sm"
                            variant="primary"
                            disabled={!planResult.plan}
                            title={planResult.error || undefined}
                            onClick={() => setStep('review')}
                        >
                            Review <ArrowRight size={13} />
                        </NemotoButton>
                    )}
                    {step === 'review' && planResult.plan && (
                        <NemotoButton
                            size="sm"
                            variant="primary"
                            disabled={planResult.plan.assets.length === 0}
                            onClick={handleResourceImport}
                        >
                            <Layers3 size={13} /> Import {planResult.plan.assets.length}
                        </NemotoButton>
                    )}
                    {step === 'reference-analysis' && validationResult?.success && (
                        <NemotoButton size="sm" variant="primary" onClick={handleImportAsReference}>
                            <FileJson size={13} /> Open temporary reference
                        </NemotoButton>
                    )}
                </div>
            </footer>
        </NemotoDialog>
    );
}
