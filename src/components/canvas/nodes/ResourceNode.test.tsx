import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReactFlowProvider } from 'reactflow';
import { ThemeProvider } from '../../../context/ThemeContext';
import { ResourceNode } from './ResourceNode';
import { usePortfolioStore } from '../../../stores/usePortfolioStore';
import { useUIStore } from '../../../stores/useUIStore';

describe('ResourceNode', () => {
    beforeEach(() => {
        usePortfolioStore.setState({
            portfolio: {
                version: '1.0.0',
                lastModified: new Date().toISOString(),
                assets: [
                    { id: 'asset-1', name: 'PostgreSQL DB', type: 'cat-sys' },
                ],
                assetCategories: [
                    { id: 'cat-sys', label: 'Systems', color: '#3b82f6', icon: 'Database' },
                ],
                processes: [],
                processFolders: [],
                incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
            },
        });

        useUIStore.setState({
            selectedAssetId: null,
            inspectorOpen: false,
        });
    });

    it('renders the asset name and category badge dynamically from the central store', () => {
        render(
            <ThemeProvider>
                <ReactFlowProvider>
                    <ResourceNode
                        id="node-res-1"
                        data={{ assetId: 'asset-1' }}
                        selected={false}
                        type="resource"
                        zIndex={1}
                        isConnectable={true}
                        xPos={0}
                        yPos={0}
                        dragging={false}
                    />
                </ReactFlowProvider>
            </ThemeProvider>
        );

        expect(screen.getByText('PostgreSQL DB')).toBeInTheDocument();
        expect(screen.getByText('Systems')).toBeInTheDocument();
    });



    it('displays fallback when asset is not found in store', () => {
        render(
            <ThemeProvider>
                <ReactFlowProvider>
                    <ResourceNode
                        id="node-res-unknown"
                        data={{ assetId: 'missing-asset' }}
                        selected={false}
                        type="resource"
                        zIndex={1}
                        isConnectable={true}
                        xPos={0}
                        yPos={0}
                        dragging={false}
                    />
                </ReactFlowProvider>
            </ThemeProvider>
        );

        expect(screen.getByText('Deleted Resource (missing-asset)')).toBeInTheDocument();
    });
});
