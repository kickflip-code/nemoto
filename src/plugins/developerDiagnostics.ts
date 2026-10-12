import { z } from 'zod';
import type { InstalledPluginDocument } from './installedPackages';
import type { PortfolioPluginRequirement } from './portfolioData';
import { satisfiesVersionRange } from './versionRange';

export const NEMOTO_PLUGIN_DIAGNOSTIC_SCHEMA = 'axiom.plugin-diagnostic';
export const NEMOTO_PLUGIN_DIAGNOSTIC_BUNDLE_SCHEMA = 'axiom.plugin-diagnostic-bundle';
export const CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DEFAULT_PLUGIN_DIAGNOSTIC_MAX_ENTRIES = 500;
export const MAX_PLUGIN_DIAGNOSTIC_MAX_ENTRIES = 1_000;
export const MAX_PLUGIN_DIAGNOSTIC_CONTEXT_BYTES = 4 * 1024;
export const MAX_PLUGIN_DIAGNOSTIC_EVENT_SAMPLE_EVERY = 100;

const REDACTED = '[REDACTED]';
const MAX_CONTEXT_FIELDS = 20;
const MAX_CONTEXT_ARRAY_ITEMS = 20;
const MAX_CONTEXT_STRING_LENGTH = 160;

const SAFE_CONTEXT_KEYS = new Set([
    'action',
    'activation',
    'actual',
    'capability',
    'count',
    'dataVersion',
    'declared',
    'effective',
    'eventType',
    'expected',
    'family',
    'granted',
    'hostApiVersion',
    'installed',
    'limit',
    'operation',
    'originKind',
    'outcome',
    'packageEntries',
    'requirement',
    'revision',
    'sampleEvery',
    'status',
]);

const SENSITIVE_CONTEXT_KEY = /(path|file|directory|portfolio|prompt|content|payload|plugin.?data|secret|token|authorization|cookie|endpoint|url|query|identifier|entity|resource|process|note|title|description|name|message)/i;
const SENSITIVE_STRING_VALUE = /(?:[A-Za-z]:[\\/]|\/(?:Users|home)\/|file:\/\/|https?:\/\/|Bearer\s+)/i;

const PluginDiagnosticSourceSchema = z.enum([
    'catalog',
    'activation',
    'content',
    'command',
    'permission',
    'host-event',
    'lifecycle',
]);

const PluginDiagnosticSeveritySchema = z.enum(['debug', 'info', 'warning', 'error']);

const PluginDiagnosticInputSchema = z.object({
    source: PluginDiagnosticSourceSchema,
    severity: PluginDiagnosticSeveritySchema,
    code: z.string().trim().min(3).max(120).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
    pluginId: z.string().trim().min(3).max(240).optional(),
    pluginVersion: z.string().trim().min(1).max(80).optional(),
    contributionId: z.string().trim().min(3).max(240).optional(),
    durationMs: z.number().finite().min(0).max(600_000).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
}).strict();

const DiagnosticContextPrimitiveSchema = z.union([
    z.string().max(MAX_CONTEXT_STRING_LENGTH + 1),
    z.number().finite(),
    z.boolean(),
    z.null(),
]);

export const PluginDiagnosticEntrySchema = z.object({
    schema: z.literal(NEMOTO_PLUGIN_DIAGNOSTIC_SCHEMA),
    schemaVersion: z.literal(CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION),
    sequence: z.number().int().positive(),
    timestamp: z.string().datetime(),
    source: PluginDiagnosticSourceSchema,
    severity: PluginDiagnosticSeveritySchema,
    code: z.string().trim().min(3).max(120).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
    pluginId: z.string().trim().min(3).max(240).optional(),
    pluginVersion: z.string().trim().min(1).max(80).optional(),
    contributionId: z.string().trim().min(3).max(240).optional(),
    durationMs: z.number().finite().min(0).max(600_000).optional(),
    context: z.record(
        z.string(),
        z.union([
            DiagnosticContextPrimitiveSchema,
            z.array(DiagnosticContextPrimitiveSchema).max(MAX_CONTEXT_ARRAY_ITEMS),
        ]),
    ).optional(),
}).strict().readonly();

type DiagnosticContextPrimitive = string | number | boolean | null;
export type PluginDiagnosticContext = Readonly<Record<
    string,
    DiagnosticContextPrimitive | readonly DiagnosticContextPrimitive[]
>>;

export type PluginDiagnosticSource = z.infer<typeof PluginDiagnosticSourceSchema>;
export type PluginDiagnosticSeverity = z.infer<typeof PluginDiagnosticSeveritySchema>;
export type PluginDiagnosticInput = z.input<typeof PluginDiagnosticInputSchema>;

export interface PluginDiagnosticEntry {
    readonly schema: typeof NEMOTO_PLUGIN_DIAGNOSTIC_SCHEMA;
    readonly schemaVersion: typeof CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION;
    readonly sequence: number;
    readonly timestamp: string;
    readonly source: PluginDiagnosticSource;
    readonly severity: PluginDiagnosticSeverity;
    readonly code: string;
    readonly pluginId?: string;
    readonly pluginVersion?: string;
    readonly contributionId?: string;
    readonly durationMs?: number;
    readonly context?: PluginDiagnosticContext;
}

export interface PluginDiagnosticLogSnapshot {
    readonly enabled: boolean;
    readonly limits: {
        readonly maxEntries: number;
        readonly maxContextBytes: number;
        readonly eventSampleEvery: number;
    };
    readonly entries: readonly PluginDiagnosticEntry[];
}

export interface PluginDiagnosticBrokerOptions {
    readonly enabled?: boolean;
    readonly maxEntries?: number;
    readonly eventSampleEvery?: number;
    readonly clock?: () => Date;
    readonly onListenerError?: () => void;
}

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object') return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.isFrozen(value) ? value : Object.freeze(value);
};

const sanitizePrimitive = (value: unknown): DiagnosticContextPrimitive | undefined => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;
    if (SENSITIVE_STRING_VALUE.test(value) || /[\r\n]/.test(value)) return REDACTED;
    return value.length <= MAX_CONTEXT_STRING_LENGTH
        ? value
        : `${value.slice(0, MAX_CONTEXT_STRING_LENGTH)}…`;
};

export function redactPluginDiagnosticContext(
    context: Readonly<Record<string, unknown>> | undefined,
): PluginDiagnosticContext | undefined {
    if (!context) return undefined;
    const redacted: Record<string, DiagnosticContextPrimitive | readonly DiagnosticContextPrimitive[]> = {};
    Object.keys(context).sort().slice(0, MAX_CONTEXT_FIELDS).forEach(key => {
        if (!SAFE_CONTEXT_KEYS.has(key) || SENSITIVE_CONTEXT_KEY.test(key)) {
            redacted[key] = REDACTED;
            return;
        }

        const value = context[key];
        if (Array.isArray(value)) {
            redacted[key] = value.slice(0, MAX_CONTEXT_ARRAY_ITEMS)
                .map(sanitizePrimitive)
                .filter((item): item is DiagnosticContextPrimitive => item !== undefined);
            return;
        }
        redacted[key] = sanitizePrimitive(value) ?? REDACTED;
    });

    if (new TextEncoder().encode(JSON.stringify(redacted)).byteLength > MAX_PLUGIN_DIAGNOSTIC_CONTEXT_BYTES) {
        return deepFreeze({ outcome: 'context-truncated', count: Object.keys(redacted).length });
    }
    return Object.keys(redacted).length > 0 ? deepFreeze(redacted) : undefined;
}

export class PluginDiagnosticBroker {
    readonly #maxEntries: number;
    readonly #eventSampleEvery: number;
    readonly #clock: () => Date;
    readonly #onListenerError?: () => void;
    readonly #listeners = new Set<() => void>();
    #enabled: boolean;
    #entries: PluginDiagnosticEntry[] = [];
    #sequence = 0;
    #eventCount = 0;

    constructor(options: PluginDiagnosticBrokerOptions = {}) {
        this.#maxEntries = Math.max(1, Math.min(
            MAX_PLUGIN_DIAGNOSTIC_MAX_ENTRIES,
            Math.floor(options.maxEntries ?? DEFAULT_PLUGIN_DIAGNOSTIC_MAX_ENTRIES),
        ));
        this.#eventSampleEvery = Math.max(1, Math.min(
            MAX_PLUGIN_DIAGNOSTIC_EVENT_SAMPLE_EVERY,
            Math.floor(options.eventSampleEvery ?? 5),
        ));
        this.#clock = options.clock || (() => new Date());
        this.#onListenerError = options.onListenerError;
        this.#enabled = options.enabled || false;
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    setEnabled(enabled: boolean): void {
        if (this.#enabled === enabled) return;
        this.#enabled = enabled;
        if (!enabled) {
            this.#entries = [];
            this.#eventCount = 0;
        }
        this.#notify();
    }

    clear(): void {
        if (this.#entries.length === 0) return;
        this.#entries = [];
        this.#notify();
    }

    record(input: PluginDiagnosticInput): PluginDiagnosticEntry | undefined {
        if (!this.#enabled) return undefined;
        const result = PluginDiagnosticInputSchema.safeParse(input);
        if (!result.success) return undefined;
        const parsed = result.data;
        if (parsed.source === 'host-event') {
            this.#eventCount += 1;
            if ((this.#eventCount - 1) % this.#eventSampleEvery !== 0) return undefined;
        }

        const context = redactPluginDiagnosticContext(parsed.context);
        const entry = deepFreeze(PluginDiagnosticEntrySchema.parse({
            schema: NEMOTO_PLUGIN_DIAGNOSTIC_SCHEMA,
            schemaVersion: CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
            sequence: ++this.#sequence,
            timestamp: this.#clock().toISOString(),
            source: parsed.source,
            severity: parsed.severity,
            code: parsed.code,
            ...(parsed.pluginId ? { pluginId: parsed.pluginId } : {}),
            ...(parsed.pluginVersion ? { pluginVersion: parsed.pluginVersion } : {}),
            ...(parsed.contributionId ? { contributionId: parsed.contributionId } : {}),
            ...(parsed.durationMs === undefined ? {} : { durationMs: parsed.durationMs }),
            ...(context ? { context } : {}),
        } satisfies PluginDiagnosticEntry));
        this.#entries = [...this.#entries, entry].slice(-this.#maxEntries);
        this.#notify();
        return entry;
    }

    getSnapshot(): PluginDiagnosticLogSnapshot {
        return deepFreeze({
            enabled: this.#enabled,
            limits: {
                maxEntries: this.#maxEntries,
                maxContextBytes: MAX_PLUGIN_DIAGNOSTIC_CONTEXT_BYTES,
                eventSampleEvery: this.#eventSampleEvery,
            },
            entries: [...this.#entries],
        });
    }

    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #notify(): void {
        this.#listeners.forEach(listener => {
            try {
                listener();
            } catch {
                try {
                    this.#onListenerError?.();
                } catch {
                    // Diagnostics must never interrupt the operation being observed.
                }
            }
        });
    }
}

export type PluginDiagnosticCompatibility =
    | 'compatible'
    | 'missing-package'
    | 'host-api-mismatch'
    | 'package-version-mismatch'
    | 'data-version-mismatch';

export interface PluginDiagnosticInventoryItem {
    readonly pluginId: string;
    readonly installed: boolean;
    readonly installedVersion?: string;
    readonly installedDataVersion?: number;
    readonly requiredVersion?: string;
    readonly requiredDataVersion?: number;
    readonly requirement: 'required' | 'recommended' | 'previously-used' | 'none';
    readonly activation: 'active' | 'inactive' | 'blocked' | 'not-requested';
    readonly compatibility: PluginDiagnosticCompatibility;
    readonly declaredCapabilities: readonly string[];
    readonly effectiveGrants: readonly string[];
    readonly contributionCounts: Readonly<Record<string, number>>;
}

export function buildPluginDiagnosticInventory(
    installed: readonly InstalledPluginDocument[],
    requirements: readonly PortfolioPluginRequirement[],
    hostPluginApiVersion: string,
): PluginDiagnosticInventoryItem[] {
    const installedById = new Map(installed.map(document => [document.manifest.id, document]));
    const requirementsById = new Map(requirements.map(requirement => [requirement.pluginId, requirement]));
    const pluginIds = new Set([...installedById.keys(), ...requirementsById.keys()]);

    return [...pluginIds].sort().map(pluginId => {
        const document = installedById.get(pluginId);
        const requirement = requirementsById.get(pluginId);
        let compatibility: PluginDiagnosticCompatibility = 'compatible';
        if (!document) compatibility = 'missing-package';
        else if (!satisfiesVersionRange(hostPluginApiVersion, document.manifest.compatibility.axiomPluginApi)) {
            compatibility = 'host-api-mismatch';
        } else if (requirement && !satisfiesVersionRange(document.manifest.version, requirement.version)) {
            compatibility = 'package-version-mismatch';
        } else if (requirement && document.manifest.dataVersion !== requirement.dataVersion) {
            compatibility = 'data-version-mismatch';
        }

        const activation = requirement?.activation === 'active'
            ? compatibility === 'compatible' ? 'active' : 'blocked'
            : requirement ? 'inactive' : 'not-requested';
        const declared = document ? [...document.manifest.capabilities].sort() : [];
        const effectiveGrants = document
            ? document.grantedCapabilities.filter(capability => declared.includes(capability)).sort()
            : [];
        const contributionCounts = document
            ? Object.fromEntries(Object.entries(document.manifest.contributes)
                .filter(([, references]) => (references?.length || 0) > 0)
                .map(([family, references]) => [family, references?.length || 0]))
            : {};

        return deepFreeze({
            pluginId,
            installed: !!document,
            ...(document ? {
                installedVersion: document.manifest.version,
                installedDataVersion: document.manifest.dataVersion,
            } : {}),
            ...(requirement ? {
                requiredVersion: requirement.version,
                requiredDataVersion: requirement.dataVersion,
            } : {}),
            requirement: requirement?.requirement || 'none',
            activation,
            compatibility,
            declaredCapabilities: declared,
            effectiveGrants,
            contributionCounts,
        } satisfies PluginDiagnosticInventoryItem);
    });
}

export interface PluginDeveloperDiagnosticSnapshot {
    readonly enabled: boolean;
    readonly hostPluginApiVersion: string;
    readonly packages: readonly PluginDiagnosticInventoryItem[];
    readonly limits: PluginDiagnosticLogSnapshot['limits'] & {
        readonly maxPackageBytes: number;
        readonly maxExpandedPackageBytes: number;
        readonly maxPackageEntries: number;
        readonly maxPackageEntryBytes: number;
        readonly maxPluginDataBytes: number;
        readonly maxPluginCollectionItems: number;
    };
    readonly entries: readonly PluginDiagnosticEntry[];
}

export interface SanitizedPluginDiagnosticBundle {
    readonly schema: typeof NEMOTO_PLUGIN_DIAGNOSTIC_BUNDLE_SCHEMA;
    readonly schemaVersion: typeof CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION;
    readonly generatedAt: string;
    readonly redaction: {
        readonly profile: 'support-default';
        readonly identifiers: 'aliased';
        readonly context: 'allowlisted';
    };
    readonly hostPluginApiVersion: string;
    readonly limits: PluginDeveloperDiagnosticSnapshot['limits'];
    readonly packages: readonly PluginDiagnosticInventoryItem[];
    readonly entries: readonly PluginDiagnosticEntry[];
}

export function createSanitizedPluginDiagnosticBundle(
    snapshot: PluginDeveloperDiagnosticSnapshot,
    generatedAt = new Date().toISOString(),
): SanitizedPluginDiagnosticBundle {
    const pluginAliases = new Map<string, string>();
    const contributionAliases = new Map<string, string>();
    const alias = (values: Map<string, string>, prefix: string, value: string): string => {
        const existing = values.get(value);
        if (existing) return existing;
        const next = `${prefix}-${values.size + 1}`;
        values.set(value, next);
        return next;
    };

    snapshot.packages.forEach(item => alias(pluginAliases, 'plugin', item.pluginId));
    snapshot.entries.forEach(entry => {
        if (entry.pluginId) alias(pluginAliases, 'plugin', entry.pluginId);
        if (entry.contributionId) alias(contributionAliases, 'contribution', entry.contributionId);
    });

    return deepFreeze({
        schema: NEMOTO_PLUGIN_DIAGNOSTIC_BUNDLE_SCHEMA,
        schemaVersion: CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
        generatedAt,
        redaction: {
            profile: 'support-default',
            identifiers: 'aliased',
            context: 'allowlisted',
        },
        hostPluginApiVersion: snapshot.hostPluginApiVersion,
        limits: snapshot.limits,
        packages: snapshot.packages.map(item => ({
            ...item,
            pluginId: alias(pluginAliases, 'plugin', item.pluginId),
        })),
        entries: snapshot.entries.map(entry => deepFreeze({
            ...entry,
            ...(entry.pluginId
                ? { pluginId: alias(pluginAliases, 'plugin', entry.pluginId) }
                : {}),
            ...(entry.contributionId
                ? { contributionId: alias(contributionAliases, 'contribution', entry.contributionId) }
                : {}),
        })),
    });
}
