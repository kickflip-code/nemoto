import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDirectory = resolve('dist');
const assetsDirectory = resolve(distDirectory, 'assets');
const indexHtml = readFileSync(resolve(distDirectory, 'index.html'), 'utf8');
const initialJavaScript = new Set(
    [...indexHtml.matchAll(/(?:src|href)="\/?([^"?#]+\.js)(?:[?#][^"]*)?"/g)]
        .map(match => match[1]),
);

if (initialJavaScript.size === 0) {
    throw new Error('No initial JavaScript assets were found in dist/index.html.');
}

const assets = [...initialJavaScript].map(relativePath => {
    const contents = readFileSync(resolve(distDirectory, relativePath));
    return {
        path: relativePath,
        gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    };
});

const totalGzipBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0);
const warningBytes = 500 * 1024;
const budgetBytes = 525 * 1024;
const formatKiB = bytes => `${(bytes / 1024).toFixed(1)} KiB`;

console.log(
    `Initial JavaScript: ${formatKiB(totalGzipBytes)} across ${assets.length} files `
    + `(warning ${formatKiB(warningBytes)}, limit ${formatKiB(budgetBytes)}).`,
);

if (totalGzipBytes > warningBytes && totalGzipBytes <= budgetBytes) {
    console.warn(
        `Initial JavaScript exceeds the ${formatKiB(warningBytes)} review threshold. `
        + 'Confirm that the increase belongs in Core before release.',
    );
}

if (totalGzipBytes > budgetBytes) {
    const largestAssets = assets
        .sort((left, right) => right.gzipBytes - left.gzipBytes)
        .slice(0, 5)
        .map(asset => `  ${formatKiB(asset.gzipBytes)}  ${asset.path}`)
        .join('\n');

    throw new Error(
        `Initial JavaScript exceeds the ${formatKiB(budgetBytes)} budget.\n${largestAssets}`,
    );
}

const assetNames = readdirSync(assetsDirectory);
const viewerTemplateAssets = assetNames
    .filter(name => name.endsWith('.html'))
    .map(name => ({
        name,
        contents: readFileSync(resolve(assetsDirectory, name)),
    }))
    .filter(asset => (
        asset.contents.includes(Buffer.from('<script id="nemoto-data"'))
        && asset.contents.includes(Buffer.from('<!--NEMOTO_DATA-->'))
    ));

if (viewerTemplateAssets.length !== 1) {
    throw new Error(
        `Expected exactly one emitted offline viewer template, found ${viewerTemplateAssets.length}.`,
    );
}

const [viewerTemplateAsset] = viewerTemplateAssets;
const viewerTemplateText = viewerTemplateAsset.contents.toString('utf8');
const viewerTemplateGzipBytes = gzipSync(viewerTemplateAsset.contents, { level: 9 }).byteLength;
const viewerTemplateBudgetBytes = 350 * 1024;

console.log(
    `Offline viewer template: ${formatKiB(viewerTemplateGzipBytes)} gzip as ${viewerTemplateAsset.name}.`,
);

if (viewerTemplateGzipBytes > viewerTemplateBudgetBytes) {
    throw new Error(
        `Offline viewer template exceeds the ${formatKiB(viewerTemplateBudgetBytes)} budget.`,
    );
}

if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=/i.test(viewerTemplateText)) {
    throw new Error('Offline viewer template must not reference external script or stylesheet assets.');
}

const javascriptWithEmbeddedViewer = assetNames
    .filter(name => name.endsWith('.js'))
    .filter(name => {
        const contents = readFileSync(resolve(assetsDirectory, name));
        return contents.includes(Buffer.from('<!DOCTYPE html>'))
            && contents.includes(Buffer.from('nemoto-data'));
    });

if (javascriptWithEmbeddedViewer.length > 0) {
    throw new Error(
        `Offline viewer HTML must remain a static asset, not JavaScript: ${javascriptWithEmbeddedViewer.join(', ')}.`,
    );
}
