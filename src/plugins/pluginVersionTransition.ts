import type { Portfolio } from '../types';
import type { InstalledPluginDocument } from './installedPackages';
import { PluginDataEnvelopeSchema, writePluginCollection } from './collectionStorage';
import { PluginViewContributionSchema } from './contributionSchemas';

export interface PluginVersionTransitionReview {
    readonly name: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly dataVersion: number;
    readonly recordCount: number;
    readonly approve: () => void;
}

/** Host-only review. The approval closure binds the live portfolio and admitted package;
 * it is never exposed to guest code. No saved namespace is rewritten or normalized. */
export function reviewPluginVersionTransition(
    pluginId: string,
    getPortfolio: () => Portfolio,
    getInstalled: () => readonly InstalledPluginDocument[],
    commit: (portfolio: Portfolio) => void,
): PluginVersionTransitionReview {
    const portfolio = getPortfolio();
    const document = getInstalled().find(item => item.manifest.id === pluginId);
    if (!document) throw new Error('The reviewed plugin is no longer installed.');
    const identity = JSON.stringify(document);
    const requirements = portfolio.plugins?.requirements.filter(item => item.pluginId === pluginId) ?? [];
    if (requirements.length !== 1) throw new Error('A single existing plugin requirement is needed for a version change.');
    const previous = requirements[0];
    if (previous.dataVersion !== document.manifest.dataVersion) {
        throw new Error('The plugin data version changed. A data migration is required; saved data was left untouched.');
    }
    const semantic = portfolio.plugins?.semanticData;
    if (semantic && [...semantic.records, ...semantic.relations, ...semantic.annotations].some(item => item.owner.pluginId === pluginId)) {
        throw new Error('This plugin owns semantic records that require an explicit migration before changing versions.');
    }
    let recordCount = 0;
    const raw = portfolio.extensions?.[pluginId];
    if (raw !== undefined) {
        const envelope = PluginDataEnvelopeSchema.safeParse(raw);
        if (!envelope.success) throw new Error('Existing plugin data cannot be validated. A migration is required; data was left untouched.');
        if (Object.keys(envelope.data.documents).length) {
            throw new Error('This plugin has stored documents without a declared compatibility schema. A migration is required; data was left untouched.');
        }
        const views = (document.manifest.contributes.views ?? []).map(reference => {
            const view = PluginViewContributionSchema.parse(document.contributions[reference.path]);
            if (view.id !== reference.id) throw new Error('The installed storage declaration does not match its manifest.');
            return view;
        });
        for (const [collectionId, collection] of Object.entries(envelope.data.collections)) {
            const schemas = views.filter(view => view.renderer === 'collection-list' && view.collection.id === collectionId);
            if (!schemas.length) throw new Error(`The installed package does not declare saved collection ${collectionId}.`);
            for (const schema of schemas) {
                if (schema.renderer === 'collection-list') {
                    // Reuse the production write validator, discarding its result: review
                    // must not rewrite timestamps, rich text, references or unknown data.
                    writePluginCollection(portfolio, pluginId, schema, collection.items);
                }
            }
            recordCount += collection.items.length;
        }
    }
    let consumed = false;
    return Object.freeze({
        name: document.manifest.name,
        fromVersion: previous.version,
        toVersion: document.manifest.version,
        dataVersion: document.manifest.dataVersion,
        recordCount,
        approve: () => {
            if (consumed || getPortfolio() !== portfolio || JSON.stringify(getInstalled().find(item => item.manifest.id === pluginId)) !== identity) {
                throw new Error('The portfolio or installed plugin changed. Review the version change again.');
            }
            consumed = true;
            commit({
                ...portfolio,
                plugins: {
                    ...portfolio.plugins!,
                    requirements: portfolio.plugins!.requirements.map(requirement => requirement.pluginId !== pluginId
                        ? requirement
                        : { ...requirement, version: `=${document.manifest.version}`, activation: 'active',
                            requirement: requirement.requirement === 'previously-used' ? 'recommended' : requirement.requirement }),
                },
            });
        },
    });
}
