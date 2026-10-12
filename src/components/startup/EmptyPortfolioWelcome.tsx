import { BookOpen, Boxes, FileUp, Keyboard, Route } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../../stores/useUIStore';
import { NemotoIcon } from '../shared/NemotoIcon';
import { NemotoButton } from '../ui';

const CONCEPTS = [
    {
        icon: Route,
        title: 'Processes',
        description: 'Map how work moves, who is involved, and where decisions are made.',
    },
    {
        icon: Boxes,
        title: 'Resources',
        description: 'Reuse systems, roles, documents, and other building blocks across processes.',
    },
    {
        icon: BookOpen,
        title: 'Journal',
        description: 'Keep notes and supporting context close to the work they explain.',
    },
] as const;

export default function EmptyPortfolioWelcome() {
    const { openImportDialog, openProcessCreation } = useUIStore(
        useShallow(state => ({
            openImportDialog: state.openImportDialog,
            openProcessCreation: state.openProcessCreation,
        })),
    );

    return (
        <div className="flex h-full w-full items-center justify-center overflow-auto bg-app-surface p-6">
            <section aria-labelledby="empty-portfolio-title" className="w-full max-w-3xl py-8">
                <div className="mx-auto max-w-2xl text-center">
                    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center">
                        <NemotoIcon size={72} />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-primary">Your local workspace</p>
                    <h1 id="empty-portfolio-title" className="mt-2 text-3xl font-bold text-text-main">Welcome to Nemoto</h1>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-text-muted">
                        Build a shared picture of how work, people, systems, and knowledge fit together. Start a process from scratch or bring in an existing Nemoto or Visio file.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <NemotoButton onClick={openProcessCreation} variant="primary">
                            <Route aria-hidden="true" size={16} />
                            Create your first process
                        </NemotoButton>
                        <NemotoButton onClick={openImportDialog}>
                            <FileUp aria-hidden="true" size={16} />
                            Import existing work
                        </NemotoButton>
                    </div>
                    <p className="mt-4 text-xs text-text-faint">
                        Your portfolio is stored locally. Nemoto saves changes automatically, and manual backups are available in Settings.
                    </p>
                </div>

                <div className="mt-10 grid gap-3 md:grid-cols-3">
                    {CONCEPTS.map(({ icon: Icon, title, description }) => (
                        <article key={title} className="nemoto-panel-card p-4">
                            <Icon aria-hidden="true" className="text-accent-primary" size={19} />
                            <h2 className="mt-3 text-sm font-bold text-text-main">{title}</h2>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
                        </article>
                    ))}
                </div>

                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-text-faint">
                    <Keyboard aria-hidden="true" size={14} />
                    <span><kbd>Ctrl+N</kbd> new process · <kbd>Ctrl+K</kbd> search · <kbd>Ctrl+S</kbd> save</span>
                </div>
            </section>
        </div>
    );
}
