import { useMemo, useRef, useState } from 'react';
import {
    Bot,
    CheckCircle2,
    FileSearch,
    Loader2,
    LockKeyhole,
    MessageSquareText,
    Send,
    ShieldCheck,
    Sparkles,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    AxiomAiBroker,
    AiBrokerError,
    resolveAiProfileDescriptor,
    type AiBrokerRunResult,
} from '../../plugins/aiBroker';
import {
    DeterministicLocalAiPocAdapter,
    LocalAiAdapterError,
    OpenAiCompatibleLocalAdapter,
} from '../../plugins/localAiAdapter';
import { pocPluginRuntime } from '../../plugins/pocRuntime';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProposalReviewStore } from '../../stores/useProposalReviewStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
    AxiomButton,
    AxiomDialog,
    AxiomDialogBody,
    AxiomDialogFooter,
    AxiomDialogHeader,
    AxiomSelect,
    AxiomTextarea,
} from '../ui';

const broker = new AxiomAiBroker();

interface LocalAiDialogProps {
    roleId: string;
    initialProfileId: string;
    onClose: () => void;
}

const isPocAdapterRequested = (): boolean => (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('ai') === 'poc'
);

const friendlyError = (error: unknown): string => {
    if (error instanceof AiBrokerError || error instanceof LocalAiAdapterError) return error.message;
    return error instanceof Error ? error.message : 'The local AI request failed.';
};

export default function LocalAiDialog({
    roleId,
    initialProfileId,
    onClose,
}: LocalAiDialogProps) {
    const portfolio = usePortfolioStore(state => state.portfolio);
    const { localAiEndpoint, localAiModel } = useSettingsStore();
    const submitProposal = useProposalReviewStore(state => state.submitProposal);
    const openReview = useProposalReviewStore(state => state.openReview);
    const profiles = useMemo(() => pocPluginRuntime.content.list('aiProfiles')
        .map(contribution => resolveAiProfileDescriptor(pocPluginRuntime, contribution.payload.id))
        .sort((left, right) => (
            left.profile.name.localeCompare(right.profile.name)
            || left.profile.id.localeCompare(right.profile.id)
        )), []);
    const [profileId, setProfileId] = useState(
        profiles.some(profile => profile.profile.id === initialProfileId)
            ? initialProfileId
            : profiles[0]?.profile.id || '',
    );
    const [prompt, setPrompt] = useState('What should a newcomer understand first, and which knowledge gap should we review?');
    const [result, setResult] = useState<AiBrokerRunResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [queuedProposalId, setQueuedProposalId] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const pocAdapter = isPocAdapterRequested();
    const configured = pocAdapter || (!!localAiEndpoint.trim() && !!localAiModel.trim());

    const close = () => {
        abortRef.current?.abort();
        onClose();
    };

    const run = async () => {
        const profile = profiles.find(candidate => candidate.profile.id === profileId);
        if (!profile || running) return;
        setRunning(true);
        setError(null);
        setResult(null);
        setQueuedProposalId(null);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const adapter = pocAdapter
                ? new DeterministicLocalAiPocAdapter()
                : new OpenAiCompatibleLocalAdapter({
                    endpoint: localAiEndpoint,
                    modelId: localAiModel,
                });
            const nextResult = await broker.run({
                portfolio,
                roleId,
                profile,
                prompt,
                adapter,
                signal: controller.signal,
            });
            setResult(nextResult);
        } catch (runError) {
            setError(friendlyError(runError));
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const sendToReview = () => {
        if (!result?.proposal) return;
        if (queuedProposalId) {
            onClose();
            openReview(queuedProposalId);
            return;
        }
        try {
            const proposalId = submitProposal(result.proposal);
            setQueuedProposalId(proposalId);
            toast.success('AI suggestion sent to proposal review');
            onClose();
            openReview(proposalId);
        } catch (submitError) {
            setError(friendlyError(submitError));
        }
    };

    const selectedProfile = profiles.find(profile => profile.profile.id === profileId);

    return (
        <AxiomDialog
            aria-describedby="local-ai-description"
            aria-labelledby="local-ai-title"
            closeOnBackdrop={!running}
            onClose={close}
            panelClassName="flex h-[78vh] w-[88vw] max-w-4xl flex-col overflow-hidden"
        >
            <AxiomDialogHeader className="flex h-16 shrink-0 items-center justify-between border-b px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-primary">
                        <Bot size={19} />
                    </div>
                    <div className="min-w-0">
                        <h2 id="local-ai-title" className="text-sm font-bold text-text-main">Local AI adviser</h2>
                        <p id="local-ai-description" className="text-[11px] text-text-muted">
                            Ask about an approved read-only projection. Suggestions require separate review.
                        </p>
                    </div>
                </div>
                <AxiomButton aria-label="Close local AI adviser" icon variant="ghost" onClick={close}>
                    <X size={18} />
                </AxiomButton>
            </AxiomDialogHeader>

            <AxiomDialogBody className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] overflow-hidden p-0">
                <aside className="min-h-0 overflow-y-auto border-r border-app-border bg-app-sidebar p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Adviser profile</div>
                    <AxiomSelect
                        aria-label="AI adviser profile"
                        className="mt-2 w-full"
                        value={profileId}
                        onChange={event => {
                            setProfileId(event.target.value);
                            setResult(null);
                            setError(null);
                        }}
                    >
                        {profiles.map(profile => (
                            <option key={profile.profile.id} value={profile.profile.id}>{profile.profile.name}</option>
                        ))}
                    </AxiomSelect>

                    {selectedProfile && (
                        <div className="mt-4 rounded-lg border border-app-border bg-app-bg p-3">
                            <div className="text-xs font-semibold text-text-main">{selectedProfile.profile.name}</div>
                            <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">{selectedProfile.profile.description}</p>
                            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-text-faint">
                                <FileSearch size={12} /> {selectedProfile.profile.context.scope.replace(/-/g, ' ')}
                            </div>
                        </div>
                    )}

                    <div className="mt-4 space-y-2 rounded-lg border border-accent-success/20 bg-accent-success/5 p-3 text-[10px] leading-relaxed text-text-muted">
                        <div className="flex items-center gap-1.5 font-semibold text-text-main">
                            <LockKeyhole size={12} className="text-accent-success" /> Host-enforced boundary
                        </div>
                        <div>Only the selected role scope is copied to the model.</div>
                        <div>Portfolio text is treated as data, not model instruction.</div>
                        <div>No response can write directly to Nemoto.</div>
                    </div>

                    <div className="mt-4 rounded-lg border border-app-border p-3 text-[10px] leading-relaxed text-text-faint">
                        {pocAdapter
                            ? 'Development POC model is active for this preview.'
                            : configured
                                ? `Attached model: ${localAiModel}`
                                : 'No local model is attached. Add its endpoint and model name in Settings.'}
                    </div>
                </aside>

                <section className="flex min-h-0 flex-col bg-app-surface">
                    <div className="border-b border-app-border p-4">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-text-faint" htmlFor="local-ai-question">
                            Your question
                        </label>
                        <AxiomTextarea
                            id="local-ai-question"
                            className="mt-2 min-h-24 w-full resize-none"
                            maxLength={4000}
                            value={prompt}
                            onChange={event => setPrompt(event.target.value)}
                            placeholder="Ask about the selected role..."
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-[10px] text-text-faint">{prompt.length}/4000 characters</span>
                            <AxiomButton
                                variant="primary"
                                disabled={!configured || !prompt.trim() || running}
                                onClick={() => { void run(); }}
                            >
                                {running ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                {running ? 'Thinking locally...' : 'Ask adviser'}
                            </AxiomButton>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-5 app-scroll">
                        {running && (
                            <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                                <Loader2 size={26} className="animate-spin text-accent-primary" />
                                <div className="mt-3 text-sm font-semibold text-text-main">Reviewing approved context</div>
                                <div className="mt-1 text-xs text-text-muted">Large local models can take several minutes. Close the dialog to cancel.</div>
                                <div className="mt-1 text-[10px] text-text-faint">The model has no access to Nemoto's stores or files.</div>
                            </div>
                        )}

                        {!running && error && (
                            <div className="rounded-lg border border-accent-danger/20 bg-accent-danger/5 p-4 text-xs leading-relaxed text-accent-danger">
                                {error}
                            </div>
                        )}

                        {!running && result && (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-app-border bg-app-bg p-4">
                                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-accent-primary">
                                        <MessageSquareText size={13} /> Source-linked answer
                                    </div>
                                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-text-main">{result.answer}</p>
                                </div>

                                <div className="rounded-xl border border-app-border bg-app-bg p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Cited Nemoto sources</div>
                                        <div className="text-[10px] text-text-faint">
                                            {result.context.sources.length} sources shared · {result.context.limits.omittedSources} omitted
                                        </div>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        {result.citations.map(citation => (
                                            <div key={citation.sourceId} className="rounded-lg border border-app-border bg-app-surface p-3">
                                                <div className="flex items-center gap-2 text-xs font-semibold text-text-main">
                                                    <CheckCircle2 size={13} className="text-accent-success" /> {citation.label}
                                                </div>
                                                {citation.note && <div className="mt-1 text-[10px] leading-relaxed text-text-muted">{citation.note}</div>}
                                                <div className="mt-1 text-[9px] text-text-faint">{citation.sourceId}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {result.proposal && (
                                    <div className="rounded-xl border border-accent-primary/30 bg-accent-primary/5 p-4">
                                        <div className="flex items-start gap-3">
                                            <Sparkles size={17} className="mt-0.5 shrink-0 text-accent-primary" />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs font-semibold text-text-main">Reviewable suggestion prepared</div>
                                                <div className="mt-1 text-[11px] leading-relaxed text-text-muted">{result.proposal.summary}</div>
                                                <div className="mt-2 text-[10px] text-text-faint">
                                                    {result.proposal.operations.length} atomic operation · no portfolio changes yet
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {!running && !result && !error && (
                            <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                                <Bot size={28} className="text-text-faint" />
                                <div className="mt-3 text-sm font-semibold text-text-main">Ready for a scoped conversation</div>
                                <div className="mt-1 max-w-sm text-xs leading-relaxed text-text-muted">
                                    Choose an adviser, ask a question, and inspect exactly which sources were used.
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </AxiomDialogBody>

            <AxiomDialogFooter className="flex min-h-16 shrink-0 items-center justify-between border-t px-5 py-3">
                <div className="flex items-center gap-1.5 text-[10px] text-text-faint">
                    <ShieldCheck size={12} className="text-accent-success" /> Conversations are session-only; only accepted proposals become portfolio data.
                </div>
                <div className="flex items-center gap-2">
                    <AxiomButton onClick={close}>Close</AxiomButton>
                    {result?.proposal && (
                        <AxiomButton variant="primary" onClick={sendToReview}>
                            <ShieldCheck size={15} /> {queuedProposalId ? 'Open review' : 'Send to review'}
                        </AxiomButton>
                    )}
                </div>
            </AxiomDialogFooter>
        </AxiomDialog>
    );
}
