import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PreparedPluginImport } from '../../stores/actions/preparedPluginImport';
import { AxiomButton, AxiomDialog, AxiomDialogFooter } from '../ui';

export default function PluginImportReviewDialog({ plan, onClose, onCommit }: {
    plan: PreparedPluginImport; onClose: () => void; onCommit: () => void;
}) {
    const [error, setError] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [page, setPage] = useState(0);
    const exclusions = plan.rows.filter(row => row.status === 'excluded').length;
    return createPortal(<AxiomDialog onClose={onClose} aria-labelledby="plugin-import-title" isolateBackground panelClassName="w-full max-w-5xl">
        <div className="p-4 space-y-4">
            <h2 id="plugin-import-title">Review plugin import</h2>
            <p>{plan.sourceName}: copied records receive new IDs. No plugin code runs during this review.</p>
            <p>Unresolved references stay unlinked with their fallback labels. Unsupported data remains in the source file.</p>
            <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm text-left">
                    <thead><tr>{['Plugin / record', 'Role', 'Source target', 'Destination', 'Result'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
                    <tbody>{plan.rows.slice(page * 50, (page + 1) * 50).map((row, index) => <tr key={index}>
                        <td className="p-2 break-all">{row.pluginId} / {row.recordId}</td>
                        <td className="p-2">{row.role}</td><td className="p-2 break-all">{row.oldTarget}</td>
                        <td className="p-2 break-all">{row.destination}</td><td className="p-2">{row.status}</td>
                    </tr>)}</tbody>
                </table>
            </div>
            {plan.rows.length > 50 && <div className="flex gap-2 items-center">
                <AxiomButton disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</AxiomButton>
                <span>Page {page + 1} of {Math.ceil(plan.rows.length / 50)} · {plan.rows.length} entries</span>
                <AxiomButton disabled={(page + 1) * 50 >= plan.rows.length} onClick={() => setPage(page + 1)}>Next</AxiomButton>
            </div>}
            {exclusions > 0 && <label className="flex gap-2"><input type="checkbox" checked={acknowledged}
                onChange={event => setAcknowledged(event.target.checked)} />I understand that {exclusions} unsupported item(s) will not be imported. I will keep the source file.</label>}
            {error && <p role="alert">{error}</p>}
        </div>
        <AxiomDialogFooter><AxiomButton onClick={onClose}>Cancel</AxiomButton>
            <AxiomButton disabled={!!error || (exclusions > 0 && !acknowledged)} onClick={() => {
                try { onCommit(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import failed; nothing was merged.'); }
            }}>Import reviewed data</AxiomButton></AxiomDialogFooter>
    </AxiomDialog>, document.body);
}
