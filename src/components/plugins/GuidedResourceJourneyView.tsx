import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
    ArrowRight,
    BookOpen,
    Bot,
    Boxes,
    CheckCircle2,
    FileText,
    GraduationCap,
    Network,
    Route,
    Sparkles,
    Users,
} from 'lucide-react';
import LocalAiDialog from './LocalAiDialog';
import type {
    PluginAiProfileContributionSchema,
    PluginQuestionSetContributionSchema,
    PluginTemplateContributionSchema,
    PluginViewContributionSchema,
    PluginVocabularyContributionSchema,
} from '../../plugins/contributionSchemas';
import {
    NemotoPanel,
    NemotoPanelBody,
    NemotoPanelCard,
    NemotoPanelHeader,
    NemotoPanelRowButton,
    NemotoButton,
} from '../ui';
import type { z } from 'zod';
import {
    usePluginHostServices,
    usePluginHostSnapshot,
} from './PluginHostServicesContext';

type PluginView = Extract<
    z.infer<typeof PluginViewContributionSchema>,
    { renderer: 'guided-resource-journey' }
>;
type QuestionSet = z.infer<typeof PluginQuestionSetContributionSchema>;
type Template = z.infer<typeof PluginTemplateContributionSchema>;
type AiProfile = z.infer<typeof PluginAiProfileContributionSchema>;
type Vocabulary = z.infer<typeof PluginVocabularyContributionSchema>;

interface GuidedResourceJourneyViewProps {
    view: PluginView;
    questionSet: QuestionSet;
    template: Template;
    aiProfile: AiProfile;
    vocabulary?: Vocabulary;
    sandbox?: boolean;
}

const relationshipLabel = {
    owner: 'Owns this process',
    participant: 'Participates',
    'owner-and-participant': 'Owns and participates',
} as const;

export default function GuidedResourceJourneyView({
    view,
    questionSet,
    template,
    aiProfile,
    vocabulary,
    sandbox = false,
}: GuidedResourceJourneyViewProps) {
    const host = usePluginHostServices();
    const { portfolioRevision } = usePluginHostSnapshot();
    const roleOptions = useMemo(
        () => host.projections.listRoleJourneyOptions(),
        [host, portfolioRevision],
    );
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(roleOptions[0]?.id || null);
    const [aiDialogOpen, setAiDialogOpen] = useState(false);

    useEffect(() => {
        if (selectedRoleId && roleOptions.some(role => role.id === selectedRoleId)) return;
        setSelectedRoleId(roleOptions[0]?.id || null);
    }, [roleOptions, selectedRoleId]);

    useEffect(() => {
        if (!sandbox && import.meta.env.DEV && new URLSearchParams(window.location.search).get('ai') === 'poc') {
            setAiDialogOpen(true);
        }
    }, [sandbox]);

    const projection = useMemo(() => (
        selectedRoleId ? host.projections.getRoleJourney(selectedRoleId) : null
    ), [host, portfolioRevision, selectedRoleId]);

    return (
        <div className="flex h-full min-h-0 w-full bg-app-bg" data-testid="plugin-role-journey">
            <NemotoPanel as="aside" className="flex w-[280px] shrink-0 flex-col border-y-0 border-l-0">
                <NemotoPanelHeader className="block px-4 py-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-accent-primary">
                        <GraduationCap size={14} />
                        {view.content.eyebrow}
                    </div>
                    <h1 className="mt-2 text-base font-semibold leading-tight text-text-main">{view.navigation.label}</h1>
                    <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{view.content.description}</p>
                </NemotoPanelHeader>

                <NemotoPanelBody className="min-h-0 flex-1 overflow-y-auto p-3 app-scroll">
                    <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-text-faint">
                        {view.scope.selectorLabel}
                    </div>
                    <div className="space-y-1" role="list" aria-label={view.scope.selectorLabel}>
                        {roleOptions.map(role => (
                            <NemotoPanelRowButton
                                key={role.id}
                                active={role.id === selectedRoleId}
                                aria-pressed={role.id === selectedRoleId}
                                onClick={() => setSelectedRoleId(role.id)}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                            >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-app-border bg-app-surface text-accent-primary">
                                    <Users size={14} />
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-xs font-semibold text-text-main">{role.name}</span>
                                    <span className="block truncate text-[10px] text-text-faint">{role.categoryLabel}</span>
                                </span>
                            </NemotoPanelRowButton>
                        ))}
                    </div>

                    {roleOptions.length === 0 && (
                        <div className="rounded-lg border border-dashed border-app-border px-3 py-5 text-center text-[11px] leading-relaxed text-text-muted">
                            No role resources are available.
                        </div>
                    )}
                </NemotoPanelBody>

                <footer className="border-t border-app-border px-4 py-3 text-[10px] leading-relaxed text-text-faint">
                    <div className="flex items-center gap-1.5 font-semibold text-text-muted">
                        <CheckCircle2 size={12} className="text-accent-success" /> Read-only plugin view
                    </div>
                    <div className="mt-1">This view can read the selected context, but it cannot change your portfolio.</div>
                </footer>
            </NemotoPanel>

            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto app-scroll">
                {!projection ? (
                    <div className="flex h-full items-center justify-center p-8">
                        <NemotoPanelCard className="max-w-md p-7 text-center">
                            <GraduationCap size={28} className="mx-auto text-text-faint" />
                            <h2 className="mt-4 text-base font-semibold text-text-main">{view.content.emptyTitle}</h2>
                            <p className="mt-2 text-xs leading-relaxed text-text-muted">{view.content.emptyDescription}</p>
                        </NemotoPanelCard>
                    </div>
                ) : (
                    <div className="mx-auto max-w-[1320px] p-6 lg:p-8">
                        <section className="relative overflow-hidden rounded-xl border border-app-border bg-app-surface px-6 py-7 shadow-sm">
                            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent-primary/10 blur-3xl" />
                            <div className="relative flex flex-wrap items-start justify-between gap-5">
                                <div className="max-w-2xl">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent-primary">
                                        {projection.role.categoryLabel} · selected journey
                                    </div>
                                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-main">{projection.role.name}</h2>
                                    <p className="mt-2 text-sm leading-relaxed text-text-muted">{view.content.title}</p>
                                </div>
                                <div className="flex items-center gap-2 rounded-full border border-app-border bg-app-bg/70 px-3 py-1.5 text-[10px] font-semibold text-text-muted">
                                    <Sparkles size={12} className="text-accent-primary" />
                                    Plugin-provided view
                                </div>
                            </div>

                            <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                                <Metric icon={Route} label="Processes" value={projection.summary.processCount} />
                                <Metric icon={Network} label="Touchpoints" value={projection.summary.touchpointCount} />
                                <Metric icon={Boxes} label="Co-resources" value={projection.summary.relatedResourceCount} />
                                <Metric icon={BookOpen} label="Knowledge" value={projection.summary.knowledgeCount} />
                            </div>
                        </section>

                        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
                            <div className="space-y-6">
                                <SectionCard
                                    icon={Route}
                                    title={view.content.touchpointsTitle}
                                    subtitle="Process participation derived from explicit resource links."
                                >
                                    {projection.processes.length > 0 && (
                                        <div className="mb-4 flex flex-wrap gap-2">
                                            {projection.processes.map(process => (
                                                <span key={process.id} className="rounded-full border border-app-border bg-app-bg px-2.5 py-1 text-[10px] text-text-muted">
                                                    <span className="font-semibold text-text-main">{process.title}</span>
                                                    {' · '}{relationshipLabel[process.relationship]}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        {projection.steps.map(step => (
                                            <div key={`${step.processId}:${step.graphId}:${step.id}`} className="rounded-lg border border-app-border bg-app-bg/60 p-3.5">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-semibold text-text-main">{step.label}</div>
                                                        <div className="mt-1 text-[10px] text-accent-primary">{step.processTitle}</div>
                                                    </div>
                                                    <span className="shrink-0 rounded border border-app-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-faint">{step.type}</span>
                                                </div>
                                                {step.description && <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{step.description}</p>}
                                            </div>
                                        ))}
                                        {projection.steps.length === 0 && (
                                            <EmptyLine text="This role owns no process and is not linked to any process step yet." />
                                        )}
                                    </div>
                                </SectionCard>

                                <SectionCard
                                    icon={BookOpen}
                                    title={view.content.knowledgeTitle}
                                    subtitle="Notes linked to the role or one of its touchpoints."
                                >
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {projection.linkedKnowledge.map(note => (
                                            <div key={note.id} className="rounded-lg border border-app-border bg-app-bg/60 p-3.5">
                                                <div className="flex items-start gap-2.5">
                                                    <FileText size={14} className="mt-0.5 shrink-0 text-accent-primary" />
                                                    <div>
                                                        <div className="text-xs font-semibold text-text-main">{note.title}</div>
                                                        <div className="mt-1 text-[10px] text-text-faint">Linked through {note.linkedThrough}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {projection.linkedKnowledge.length === 0 && (
                                            <EmptyLine text="No journal knowledge is linked to this role or its touchpoints." />
                                        )}
                                    </div>
                                </SectionCard>

                                {projection.relatedResources.length > 0 && (
                                    <SectionCard
                                        icon={Boxes}
                                        title="Frequent collaborators and tools"
                                        subtitle="Resources that share at least one process touchpoint with the selected role."
                                    >
                                        <div className="flex flex-wrap gap-2">
                                            {projection.relatedResources.map(resource => (
                                                <div key={resource.id} className="rounded-lg border border-app-border bg-app-bg/60 px-3 py-2">
                                                    <div className="text-xs font-semibold text-text-main">{resource.name}</div>
                                                    <div className="mt-0.5 text-[10px] text-text-faint">
                                                        {resource.categoryLabel} · {resource.sharedStepCount} shared {resource.sharedStepCount === 1 ? 'step' : 'steps'}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </SectionCard>
                                )}
                            </div>

                            <aside className="space-y-6">
                                <SectionCard icon={GraduationCap} title={questionSet.title} subtitle={questionSet.description}>
                                    <ol className="space-y-3">
                                        {questionSet.questions.map((question, index) => (
                                            <li key={question.id} className="flex gap-3">
                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-app-border bg-app-bg text-[10px] font-bold text-accent-primary">
                                                    {index + 1}
                                                </span>
                                                <div>
                                                    <div className="text-xs font-medium leading-relaxed text-text-main">{question.prompt}</div>
                                                    <div className="mt-1 text-[10px] leading-relaxed text-text-faint">{question.purpose}</div>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                </SectionCard>

                                <SectionCard icon={FileText} title={template.title} subtitle={template.description}>
                                    <div className="space-y-2">
                                        {template.sections.map((section, index) => (
                                            <div key={section.id} className="flex items-start gap-2.5 rounded-lg border border-app-border bg-app-bg/60 p-3">
                                                <ArrowRight size={13} className="mt-0.5 shrink-0 text-accent-primary" />
                                                <div>
                                                    <div className="text-[11px] font-semibold text-text-main">{index + 1}. {section.heading}</div>
                                                    <div className="mt-1 text-[10px] leading-relaxed text-text-faint">{section.guidance}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </SectionCard>

                                <section className="rounded-xl border border-accent-primary/30 bg-accent-primary/5 p-4" aria-labelledby="plugin-ai-profile-title">
                                    <div className="flex items-start gap-3">
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent-primary/30 bg-app-surface text-accent-primary">
                                            <Bot size={16} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-accent-primary">Local AI adviser</div>
                                            <h3 id="plugin-ai-profile-title" className="mt-1 text-sm font-semibold text-text-main">{aiProfile.name}</h3>
                                            <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{aiProfile.description}</p>
                                        </div>
                                    </div>
                                    <div className="mt-3 rounded-lg border border-app-border bg-app-surface/70 p-3 text-[10px] leading-relaxed text-text-muted">
                                        {sandbox
                                            ? 'Sandbox projection · AI and proposal hand-off disabled'
                                            : 'Read-only context · source-linked proposals · cannot change the portfolio'}
                                    </div>
                                    <div className="mt-2 text-[10px] text-text-faint">
                                        {vocabulary?.terms.length || 0} domain terms are available to the declared adviser profile.
                                    </div>
                                    <NemotoButton
                                        className="mt-3 w-full justify-center"
                                        disabled={!selectedRoleId || sandbox}
                                        onClick={() => setAiDialogOpen(true)}
                                        variant="primary"
                                    >
                                        <Bot size={14} /> {sandbox ? 'Unavailable in sandbox' : 'Ask local AI'}
                                    </NemotoButton>
                                </section>
                            </aside>
                        </div>
                    </div>
                )}
            </main>
            {!sandbox && aiDialogOpen && selectedRoleId && (
                <LocalAiDialog
                    initialProfileId={aiProfile.id}
                    onClose={() => setAiDialogOpen(false)}
                    roleId={selectedRoleId}
                />
            )}
        </div>
    );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Route; label: string; value: number }) {
    return (
        <div className="rounded-lg border border-app-border bg-app-bg/60 p-3">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-text-faint">
                <Icon size={13} className="text-accent-primary" /> {label}
            </div>
            <div className="mt-2 text-xl font-semibold text-text-main">{value}</div>
        </div>
    );
}

function SectionCard({
    icon: Icon,
    title,
    subtitle,
    children,
}: {
    icon: typeof Route;
    title: string;
    subtitle: string;
    children: ReactNode;
}) {
    return (
        <section className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-bg text-accent-primary">
                    <Icon size={15} />
                </span>
                <div>
                    <h3 className="text-sm font-semibold text-text-main">{title}</h3>
                    <p className="mt-1 text-[10px] leading-relaxed text-text-faint">{subtitle}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

function EmptyLine({ text }: { text: string }) {
    return (
        <div className="col-span-full rounded-lg border border-dashed border-app-border px-4 py-5 text-center text-[11px] text-text-muted">
            {text}
        </div>
    );
}
