import type { NemotoDocumentKind } from '../../lib/portfolioCodec';

interface NemotoDocumentMetadataProps {
    kind: NemotoDocumentKind;
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    sourceAppVersion?: string;
    sourceTimestamp?: string;
    wasWrapped: boolean;
}

function formatTimestamp(timestamp: string | undefined): string {
    if (!timestamp) return 'Not recorded';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

export default function NemotoDocumentMetadata({
    kind,
    sourceSchemaVersion,
    targetSchemaVersion,
    sourceAppVersion,
    sourceTimestamp,
    wasWrapped,
}: NemotoDocumentMetadataProps) {
    const needsSchemaMigration = sourceSchemaVersion < targetSchemaVersion;
    const typeLabel = kind === 'process-fragment' ? 'Process fragment' : 'Portfolio';
    const versionLabel = needsSchemaMigration
        ? `${sourceSchemaVersion === 0 ? 'Legacy' : sourceSchemaVersion} → ${targetSchemaVersion}`
        : String(sourceSchemaVersion);

    return (
        <div className="nemoto-dialog-panel overflow-hidden" data-testid="nemoto-document-metadata">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-3 text-xs">
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-faint">File type</div>
                    <div className="mt-0.5 text-text-main">{typeLabel}</div>
                </div>
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-faint">Data version</div>
                    <div className="mt-0.5 text-text-main">{versionLabel}</div>
                </div>
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-faint">Created with</div>
                    <div className="mt-0.5 text-text-main">
                        {sourceAppVersion ? `Version ${sourceAppVersion}` : 'Version not recorded'}
                    </div>
                </div>
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-faint">Exported</div>
                    <div className="mt-0.5 text-text-main">{formatTimestamp(sourceTimestamp)}</div>
                </div>
            </div>
            {(!wasWrapped || needsSchemaMigration) && (
                <div className="border-t border-app-border/50 px-3 py-2 text-[10px] text-accent-warning">
                    {needsSchemaMigration
                        ? `Older data will be migrated safely to version ${targetSchemaVersion} during import.`
                        : 'Legacy unwrapped file; metadata may be incomplete.'}
                </div>
            )}
        </div>
    );
}
