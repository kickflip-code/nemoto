import { AlertTriangle, History, RotateCcw } from 'lucide-react';
import { AxiomButton } from '../ui';
import PortfolioProcessRepair from './PortfolioProcessRepair';

interface PortfolioLoadFailureProps {
    error: string;
    recoveryAvailable: boolean;
    onRecover: () => void;
    onRetry: () => void;
}

export default function PortfolioLoadFailure({
    error,
    recoveryAvailable,
    onRecover,
    onRetry,
}: PortfolioLoadFailureProps) {
    return (
        <main className="flex h-screen w-screen items-start justify-center overflow-y-auto bg-app-bg p-6 text-text-main">
            <section
                aria-describedby="portfolio-load-error-description portfolio-load-error-detail"
                aria-labelledby="portfolio-load-error-title"
                className="axiom-dialog-panel my-auto w-full max-w-2xl p-8"
            >
                <div className="axiom-dialog-icon axiom-dialog-icon-warning mb-5 flex h-14 w-14 items-center justify-center">
                    <AlertTriangle aria-hidden="true" size={28} />
                </div>
                <h1 id="portfolio-load-error-title" className="text-xl font-bold">
                    Nemoto could not open your portfolio
                </h1>
                <p id="portfolio-load-error-description" className="mt-3 text-sm leading-relaxed text-text-muted">
                    Auto-save is paused on this screen. Retry loading, restore a validated recovery file, or manage damaged processes below. Process removal preserves a separate copy of your original file.
                </p>
                <div
                    id="portfolio-load-error-detail"
                    className="mt-5 rounded border border-app-border bg-app-surface p-3 font-mono text-xs text-text-muted"
                    role="status"
                >
                    {error}
                </div>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <AxiomButton onClick={onRetry}>
                        <RotateCcw aria-hidden="true" size={15} />
                        Try again
                    </AxiomButton>
                    {recoveryAvailable && (
                        <AxiomButton onClick={onRecover} variant="primary">
                            <History aria-hidden="true" size={15} />
                            Restore recovery file
                        </AxiomButton>
                    )}
                </div>
                <PortfolioProcessRepair onRepaired={onRetry} />
            </section>
        </main>
    );
}
