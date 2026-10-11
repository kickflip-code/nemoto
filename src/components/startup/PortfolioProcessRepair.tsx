import { useMemo, useState } from 'react';
import { AxiomButton } from '../ui';
import { loadPortfolioForRepair, repairPortfolioProcesses, type PortfolioRepairSnapshot } from '../../lib/tauri';
import { describeRepairError, inspectRepairProcesses, prepareProcessRepair } from '../../lib/portfolioRepair';
import { formatError } from '../../lib/errorUtils';

export default function PortfolioProcessRepair({ onRepaired }: { onRepaired: () => void }) {
    const [snapshot, setSnapshot] = useState<PortfolioRepairSnapshot>();
    const source = snapshot?.portfolio;
    const [selected, setSelected] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [backupPath, setBackupPath] = useState<string | null>(null);
    const rows = useMemo(() => source ? inspectRepairProcesses(source) : [], [source]);
    const preview = useMemo(() => {
        if (!source) return null;
        try { return { result: prepareProcessRepair(source, selected), error: null }; }
        catch (failure) { return { result: null, error: describeRepairError(failure) }; }
    }, [source, selected]);

    const inspect = async () => {
        setBusy(true);
        setError(null);
        try {
            const raw = await loadPortfolioForRepair();
            inspectRepairProcesses(raw.portfolio);
            setSnapshot(raw);
            setSelected([]);
            setBackupPath(null);
        } catch (failure) { setError(formatError(failure)); }
        finally { setBusy(false); }
    };
    const repair = async () => {
        if (!preview?.result || !snapshot || !selected.length || busy) return;
        setBusy(true);
        setError(null);
        try {
            // Revalidate at the write boundary. Native code independently applies
            // the same index-only removal and checks that the source is unchanged.
            prepareProcessRepair(source, selected);
            const path = await repairPortfolioProcesses(snapshot.revision, selected);
            setBackupPath(path);
            setSnapshot(undefined);
            setSelected([]);
        } catch (failure) { setError(formatError(failure)); }
        finally { setBusy(false); }
    };

    return <section className="mt-6 border-t border-app-border pt-5" aria-label="Process recovery">
        {backupPath ? <>
            <p role="status" className="text-sm">Selected processes removed. The original file is preserved at:</p>
            <p className="my-3 break-all font-mono text-xs">{backupPath}</p>
            <AxiomButton variant="primary" onClick={onRepaired}>Open repaired portfolio</AxiomButton>
        </> : <>
            <AxiomButton disabled={busy} onClick={() => { void inspect(); }}>
                {source ? 'Reload process list' : 'Manage damaged processes'}
            </AxiomButton>
            {source !== undefined && <>
                <p className="my-3 text-sm text-text-muted">Read the process details and select processes to remove. Nothing changes until you choose Remove selected processes. Resources and Journal are kept, including links to removed processes. A separate original file is preserved before saving.</p>
                <fieldset disabled={busy} className="space-y-3">
                    <legend className="sr-only">Processes to remove</legend>
                    {rows.map(row => <div key={row.index} className="rounded border border-app-border p-3">
                        <label className="flex items-start gap-3 font-semibold">
                            <input type="checkbox" checked={selected.includes(row.index)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row.index] : previous.filter(index => index !== row.index))} />
                            {row.title}
                        </label>
                        {row.description && <p className="mt-2 whitespace-pre-wrap text-sm">{row.description}</p>}
                        {row.issues.length > 0 && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-text-muted">{row.issues.join('\n')}</p>}
                        <details className="mt-2 text-xs"><summary>Read process data</summary>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(row.raw, null, 2)}</pre>
                        </details>
                    </div>)}
                </fieldset>
                <div role="status" className="my-3 whitespace-pre-wrap break-words text-sm">
                    {preview?.error ? `Remaining data cannot open yet:\n${preview.error}` : `${rows.length - selected.length} process(es) will remain. Remaining data passes validation.${preview?.result?.warnings.length ? ` ${preview.result.warnings.length} reference warning(s) remain; Journal content is preserved.` : ''}`}
                </div>
                <AxiomButton variant="danger" disabled={busy || !selected.length || !preview?.result} onClick={() => { void repair(); }}>
                    Remove selected processes ({selected.length})
                </AxiomButton>
            </>}
        </>}
        {error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-sm">{error}</p>}
    </section>;
}
