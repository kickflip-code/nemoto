import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

export default defineConfig({
    root: resolve(__dirname, 'src/export/viewer'),
    publicDir: false,
    plugins: [react(), viteSingleFile()],
    build: {
        outDir: resolve(__dirname, 'dist-viewer'),
        emptyOutDir: true,
        target: 'es2020',
        assetsInlineLimit: 100000000,
        chunkSizeWarningLimit: 100000000,
        cssCodeSplit: false,
        rollupOptions: {
            input: resolve(__dirname, 'src/export/viewer/index.html'),
            output: {
                inlineDynamicImports: true,
                manualChunks: undefined, // Must be undefined for inlineDynamicImports
            },
        },
    },
});
