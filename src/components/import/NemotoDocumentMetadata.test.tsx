import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NemotoDocumentMetadata from './NemotoDocumentMetadata';

describe('NemotoDocumentMetadata', () => {
    it('shows current process-fragment metadata', () => {
        render(
            <NemotoDocumentMetadata
                kind="process-fragment"
                sourceSchemaVersion={1}
                targetSchemaVersion={1}
                sourceAppVersion="0.13.1"
                sourceTimestamp="2026-08-12T12:00:00.000Z"
                wasWrapped
            />,
        );

        expect(screen.getByText('Process fragment')).toBeInTheDocument();
        expect(screen.getByText('Version 0.13.1')).toBeInTheDocument();
        expect(screen.queryByText(/migrated safely/i)).not.toBeInTheDocument();
    });

    it('labels legacy data and explains automatic migration', () => {
        render(
            <NemotoDocumentMetadata
                kind="portfolio"
                sourceSchemaVersion={0}
                targetSchemaVersion={1}
                wasWrapped={false}
            />,
        );

        expect(screen.getByText('Portfolio')).toBeInTheDocument();
        expect(screen.getByText('Legacy → 1')).toBeInTheDocument();
        expect(screen.getByText(/migrated safely to version 1/i)).toBeInTheDocument();
        expect(screen.getByText('Version not recorded')).toBeInTheDocument();
    });
});
