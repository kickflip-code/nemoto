import { describe, expect, it } from 'vitest';
import {
  createThemeEmbeddedAsset,
  verifyThemeEmbeddedAsset,
} from './themeAssets';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const woff2Bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00]);

describe('embedded theme asset integrity', () => {
  it('creates and verifies signed PNG and WOFF2 assets', async () => {
    const logo = await createThemeEmbeddedAsset(new File([pngBytes], 'logo.png'), 'image/png');
    const font = await createThemeEmbeddedAsset(new File([woff2Bytes], 'brand.woff2'), 'font/woff2');

    await expect(verifyThemeEmbeddedAsset('brand-logo', logo)).resolves.toBeUndefined();
    await expect(verifyThemeEmbeddedAsset('brand-font', font)).resolves.toBeUndefined();
    expect(logo.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects MIME confusion and digest tampering', async () => {
    const logo = await createThemeEmbeddedAsset(new File([pngBytes], 'logo.png'), 'image/png');

    await expect(verifyThemeEmbeddedAsset('brand-logo', {
      ...logo,
      mediaType: 'image/webp',
    })).rejects.toThrow(/does not match image\/webp/);
    await expect(verifyThemeEmbeddedAsset('brand-logo', {
      ...logo,
      sha256: '0'.repeat(64),
    })).rejects.toThrow(/integrity verification/);
  });
});
