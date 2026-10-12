import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { NemotoButton } from '../ui';

interface AppErrorBoundaryProps {
    children: ReactNode;
}

interface AppErrorBoundaryState {
    error: Error | null;
}

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('Nemoto encountered an unexpected interface error:', error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <main className="flex h-screen w-screen items-center justify-center bg-app-bg p-6 text-text-main">
                <section aria-labelledby="app-error-title" className="nemoto-dialog-panel w-full max-w-lg p-8" role="alert">
                    <div className="nemoto-dialog-icon nemoto-dialog-icon-warning mb-5 flex h-14 w-14 items-center justify-center">
                        <AlertTriangle aria-hidden="true" size={28} />
                    </div>
                    <h1 id="app-error-title" className="text-xl font-bold">Nemoto hit an unexpected problem</h1>
                    <p className="mt-3 text-sm leading-relaxed text-text-muted">
                        The current view could not continue. Your portfolio file has not been deleted. Try reopening the view; if the problem returns, restart Nemoto and restore the recovery file if needed.
                    </p>
                    <div className="mt-5 rounded border border-app-border bg-app-surface p-3 font-mono text-xs text-text-muted">
                        {this.state.error.message || 'Unknown interface error'}
                    </div>
                    <div className="mt-6 flex justify-end">
                        <NemotoButton onClick={() => this.setState({ error: null })} variant="primary">
                            <RotateCcw aria-hidden="true" size={15} />
                            Try reopening the view
                        </NemotoButton>
                    </div>
                </section>
            </main>
        );
    }
}
