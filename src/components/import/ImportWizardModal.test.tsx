import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '../../types';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import ImportWizardModal, {
    MAX_TEXT_IMPORT_BYTES,
    REFERENCE_FILE_ACCEPT,
    RESOURCE_FILE_ACCEPT,
} from './ImportWizardModal';

const nativeFileMocks = vi.hoisted(() => ({
    isTauri: vi.fn(() => false),
    open: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    onDragDropEvent: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: nativeFileMocks.isTauri }));
vi.mock('@tauri-apps/api/webview', () => ({
    getCurrentWebview: () => ({ onDragDropEvent: nativeFileMocks.onDragDropEvent }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: nativeFileMocks.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: nativeFileMocks.readFile,
    stat: nativeFileMocks.stat,
}));

const timestamp = '2026-08-25T00:00:00.000Z';

const createPortfolio = (): Portfolio => ({
    version: '1.0',
    lastModified: timestamp,
    processes: [],
    processFolders: [],
    assets: [],
    assetCategories: [
        { id: 'systems', label: 'Systems', icon: 'Database', color: 'blue' },
        { id: 'hardware', label: 'Hardware', icon: 'Box', color: 'gray' },
    ],
    incidents: [],
    journal: { notebooks: [], entries: [], tags: [], folders: [] },
});

describe('ImportWizardModal accessibility', () => {
    beforeEach(() => {
        nativeFileMocks.isTauri.mockReturnValue(false);
        nativeFileMocks.open.mockReset();
        nativeFileMocks.readFile.mockReset();
        nativeFileMocks.stat.mockReset();
        nativeFileMocks.onDragDropEvent.mockReset().mockResolvedValue(vi.fn());
        usePortfolioStore.setState({ portfolio: createPortfolio() });
    });

    it('provides dialog semantics, distinct import choices, and Escape handling', () => {
        const onClose = vi.fn();
        render(<ImportWizardModal isOpen onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Import' });
        expect(dialog).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Import resources' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open portfolio or process' })).toBeInTheDocument();
        expect(screen.queryByLabelText(/Choose .* file/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Step 1 of 3/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Import resources' }));
        expect(screen.getByLabelText('Choose a resource spreadsheet or JSON file')).toHaveAttribute(
            'accept',
            RESOURCE_FILE_ACCEPT,
        );
        expect(screen.getByLabelText('Step 1 of 3')).toHaveTextContent('Source');

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('rejects an oversized text import before reading it into memory', async () => {
        const file = new File(['{}'], 'oversized.axiom', { type: 'application/json' });
        Object.defineProperty(file, 'size', { value: MAX_TEXT_IMPORT_BYTES + 1 });
        const textSpy = vi.spyOn(file, 'text');
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        fireEvent.click(screen.getByRole('button', { name: 'Open portfolio or process' }));
        expect(screen.getByLabelText('Choose a Nemoto portfolio, process fragment, JSON, or Visio file')).toHaveAttribute(
            'accept',
            REFERENCE_FILE_ACCEPT,
        );
        fireEvent.change(
            screen.getByLabelText('Choose a Nemoto portfolio, process fragment, JSON, or Visio file'),
            { target: { files: [file] } },
        );

        expect(await screen.findByText(/larger than the 50 MB import limit/i)).toBeInTheDocument();
        expect(textSpy).not.toHaveBeenCalled();
    });

    it('maps a CSV name, category, and property before importing one batch', async () => {
        const importResources = vi.fn();
        usePortfolioStore.setState({ importResources });
        const file = new File([
            'Resource name,Owner,Cost\nLaptop,Support,249.50',
        ], 'resources.csv', { type: 'text/csv' });
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        fireEvent.click(screen.getByRole('button', { name: 'Import resources' }));
        fireEvent.change(
            screen.getByLabelText('Choose a resource spreadsheet or JSON file'),
            { target: { files: [file] } },
        );

        expect(await screen.findByText('Each row will become one resource.')).toBeInTheDocument();
        expect(screen.getByLabelText('Resource name')).toHaveValue('0');
        expect(screen.getByLabelText('Import Resource name as a property')).toBeDisabled();
        expect(screen.getByLabelText('Import Owner as a property')).toBeChecked();
        expect(screen.getByLabelText('Property type for Cost')).toHaveValue('number');

        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'hardware' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByRole('heading', { name: 'Ready to import' })).toBeInTheDocument();
        expect(screen.getByText('Laptop')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Import 1' }));

        await waitFor(() => expect(importResources).toHaveBeenCalledOnce());
        expect(importResources.mock.calls[0][0]).toEqual([
            expect.objectContaining({
                name: 'Laptop',
                type: 'hardware',
                metadata: { Owner: 'Support', Cost: 249.5 },
            }),
        ]);
    });

    it('keeps the native file selection alive until asynchronous reading finishes', async () => {
        const user = userEvent.setup();
        let finishReading: ((text: string) => void) | undefined;
        const file = new File([''], 'resources.tsv', { type: 'text/tab-separated-values' });
        vi.spyOn(file, 'text').mockReturnValue(new Promise(resolve => {
            finishReading = resolve;
        }));
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        await user.click(screen.getByRole('button', { name: 'Import resources' }));
        const input = screen.getByLabelText('Choose a resource spreadsheet or JSON file') as HTMLInputElement;
        await user.upload(input, file);

        expect(input.files).toHaveLength(1);
        expect(screen.getByText('Reading file…')).toBeInTheDocument();

        finishReading?.('Resource name\tOwner\nRouter\tIT');
        expect(await screen.findByText('Each row will become one resource.')).toBeInTheDocument();
    });

    it('can load another resource file after returning from an unfinished import', async () => {
        const user = userEvent.setup();
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        await user.click(screen.getByRole('button', { name: 'Import resources' }));
        await user.upload(
            screen.getByLabelText('Choose a resource spreadsheet or JSON file'),
            new File(['Resource name,Owner\nLaptop,Support'], 'first.csv', { type: 'text/csv' }),
        );
        expect(await screen.findByText('first.csv')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Back' }));
        await user.upload(
            screen.getByLabelText('Choose a resource spreadsheet or JSON file'),
            new File([
                JSON.stringify({ resources: [{ name: 'Router', owner: { team: 'IT' } }] }),
            ], 'second.json', { type: 'application/json' }),
        );

        expect(await screen.findByText('second.json')).toBeInTheDocument();
        expect(screen.getByLabelText('Resource name')).toHaveValue('0');
        expect(screen.getByLabelText('Import owner.team as a property')).toBeChecked();
    });

    it('uses the native desktop picker repeatedly without relying on a hidden file input', async () => {
        const user = userEvent.setup();
        nativeFileMocks.isTauri.mockReturnValue(true);
        nativeFileMocks.open
            .mockResolvedValueOnce('C:\\imports\\first.csv')
            .mockResolvedValueOnce('C:\\imports\\second.json');
        nativeFileMocks.stat.mockResolvedValue({ size: 100 });
        nativeFileMocks.readFile
            .mockResolvedValueOnce(new TextEncoder().encode('Resource name,Owner\nLaptop,Support'))
            .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify({
                resources: [{ name: 'Router', owner: { team: 'IT' } }],
            })));
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        await user.click(screen.getByRole('button', { name: 'Import resources' }));
        const firstPicker = screen.getByRole('button', { name: 'Choose a resource spreadsheet or JSON file' });
        expect(firstPicker).toHaveClass('opacity-0');
        expect(screen.getByText('Drop a file here or choose one')).toBeInTheDocument();
        expect(screen.queryByLabelText('Choose a resource spreadsheet or JSON file', { selector: 'input' }))
            .not.toBeInTheDocument();
        await user.click(firstPicker);
        expect(await screen.findByText('first.csv')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Back' }));
        await user.click(screen.getByRole('button', { name: 'Choose a resource spreadsheet or JSON file' }));

        expect(await screen.findByText('second.json')).toBeInTheDocument();
        expect(nativeFileMocks.open).toHaveBeenCalledTimes(2);
        expect(nativeFileMocks.readFile).toHaveBeenNthCalledWith(2, 'C:\\imports\\second.json');
    });

    it('accepts a pasted tabular source through the same mapping flow', async () => {
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        fireEvent.click(screen.getByRole('button', { name: 'Import resources' }));
        fireEvent.click(screen.getByRole('button', { name: 'Paste a table' }));
        fireEvent.change(screen.getByLabelText('Pasted resource table'), {
            target: { value: 'Name\tOwner\nRouter\tIT' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Use pasted table' }));

        expect(await screen.findByText('Each row will become one resource.')).toBeInTheDocument();
        expect(screen.getByText('Pasted table')).toBeInTheDocument();
        expect(screen.getByLabelText('Resource name')).toHaveValue('0');
    });

    it('keeps portfolio and process files out of the resource source screen', () => {
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        fireEvent.click(screen.getByRole('button', { name: 'Open portfolio or process' }));

        expect(screen.getByRole('heading', { name: 'Portfolio or process' })).toBeInTheDocument();
        expect(screen.getByLabelText('Choose a Nemoto portfolio, process fragment, JSON, or Visio file'))
            .toHaveAttribute('accept', REFERENCE_FILE_ACCEPT);
        expect(screen.queryByRole('button', { name: 'Paste a table' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Step 1 of 3/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('button', { name: 'Import resources' })).toBeInTheDocument();
    });

    it('preserves the existing portfolio validation path behind its own choice', async () => {
        const file = new File(
            [JSON.stringify(createPortfolio())],
            'portfolio.json',
            { type: 'application/json' },
        );
        render(<ImportWizardModal isOpen onClose={() => undefined} />);

        fireEvent.click(screen.getByRole('button', { name: 'Open portfolio or process' }));
        fireEvent.change(
            screen.getByLabelText('Choose a Nemoto portfolio, process fragment, JSON, or Visio file'),
            { target: { files: [file] } },
        );

        expect(await screen.findByText('Validation successful')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open temporary reference' })).toBeInTheDocument();
        expect(screen.queryByLabelText(/Step \d of 3/)).not.toBeInTheDocument();
    });

    it.each(['nemoto', 'nemoto-process', 'axiom', 'ax'])('accepts %s process inputs', async extension => {
        render(<ImportWizardModal isOpen onClose={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open portfolio or process' }));
        const file = new File([JSON.stringify(createPortfolio())], `process.${extension}`);
        fireEvent.drop(screen.getByLabelText('Choose a Nemoto portfolio, process fragment, JSON, or Visio file'),
            { dataTransfer: { files: [file] } });
        expect(await screen.findByText('Validation successful')).toBeInTheDocument();
    });

    it.each(['reference', 'resource'])('accepts browser drops through the %s validation flow', async kind => {
        render(<ImportWizardModal isOpen onClose={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: kind === 'reference' ? 'Open portfolio or process' : 'Import resources' }));
        const file = kind === 'reference'
            ? new File([JSON.stringify(createPortfolio())], 'process.ax')
            : new File(['Name,Owner\nRouter,IT'], 'resources.csv');
        fireEvent.drop(screen.getByLabelText(kind === 'reference'
            ? 'Choose a Nemoto portfolio, process fragment, JSON, or Visio file'
            : 'Choose a resource spreadsheet or JSON file'), { dataTransfer: { files: [file] } });
        expect(await screen.findByText(kind === 'reference' ? 'Validation successful' : 'Each row will become one resource.')).toBeInTheDocument();
        expect(nativeFileMocks.open).not.toHaveBeenCalled();
    });

    it('accepts native drops inside the zone at Windows display scaling and ignores other positions and duplicate drops', async () => {
        nativeFileMocks.isTauri.mockReturnValue(true);
        nativeFileMocks.stat.mockResolvedValue({ size: 100 });
        nativeFileMocks.readFile.mockResolvedValue(new TextEncoder().encode(JSON.stringify(createPortfolio())));
        const unlisten = vi.fn();
        nativeFileMocks.onDragDropEvent.mockResolvedValue(unlisten);
        render(<ImportWizardModal isOpen onClose={() => undefined} />);
        expect(nativeFileMocks.onDragDropEvent).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Open portfolio or process' }));
        const zone = screen.getByLabelText('Choose a Nemoto portfolio, process fragment, JSON, or Visio file').parentElement!;
        vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 300, top: 100, bottom: 300 } as DOMRect);
        const scale = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
        const listener = nativeFileMocks.onDragDropEvent.mock.calls[0][0];
        await act(async () => {
            listener({ payload: { type: 'drop', paths: ['C:\\outside.ax'], position: { x: 50, y: 50 } } });
        });
        expect(nativeFileMocks.stat).not.toHaveBeenCalled();
        await act(async () => {
            const event = { payload: { type: 'drop', paths: ['C:\\process.ax'], position: { x: 500, y: 500 } } };
            listener(event);
            listener(event);
        });
        expect(await screen.findByText('Validation successful')).toBeInTheDocument();
        expect(nativeFileMocks.readFile).toHaveBeenCalledExactlyOnceWith('C:\\process.ax');
        expect(nativeFileMocks.open).not.toHaveBeenCalled();
        expect(unlisten).toHaveBeenCalledOnce();
        scale.mockRestore();
    });

    it('rejects multiple native files and oversized native drops before reading bytes', async () => {
        nativeFileMocks.isTauri.mockReturnValue(true);
        nativeFileMocks.stat.mockResolvedValue({ size: MAX_TEXT_IMPORT_BYTES + 1 });
        render(<ImportWizardModal isOpen onClose={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Import resources' }));
        const listener = nativeFileMocks.onDragDropEvent.mock.calls[0][0];
        await act(async () => listener({ payload: { type: 'drop', paths: ['a.csv', 'b.csv'], position: { x: 0, y: 0 } } }));
        expect(screen.getByRole('alert')).toHaveTextContent('Drop one file at a time.');
        expect(nativeFileMocks.stat).not.toHaveBeenCalled();
        await act(async () => listener({ payload: { type: 'drop', paths: ['huge.csv'], position: { x: 0, y: 0 } } }));
        expect(screen.getByRole('alert')).toHaveTextContent('50 MB');
        expect(nativeFileMocks.readFile).not.toHaveBeenCalled();
    });

    it('unsubscribes a late native subscription after closing and ignores its events', async () => {
        nativeFileMocks.isTauri.mockReturnValue(true);
        let resolveSubscription!: (stop: () => void) => void;
        nativeFileMocks.onDragDropEvent.mockReturnValue(new Promise(resolve => { resolveSubscription = resolve; }));
        const { rerender } = render(<ImportWizardModal isOpen onClose={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open portfolio or process' }));
        const listener = nativeFileMocks.onDragDropEvent.mock.calls[0][0];
        rerender(<ImportWizardModal isOpen={false} onClose={() => undefined} />);
        const stop = vi.fn();
        await act(async () => {
            resolveSubscription(stop);
            listener({ payload: { type: 'drop', paths: ['closed.ax'], position: { x: 0, y: 0 } } });
        });
        expect(stop).toHaveBeenCalledOnce();
        expect(nativeFileMocks.readFile).not.toHaveBeenCalled();
    });
});
