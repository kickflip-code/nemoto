import type { ThemeEmbeddedAsset } from './themeContract';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32];

const bytesStartWith = (bytes: Uint8Array, signature: number[]): boolean => (
  signature.every((byte, index) => bytes[index] === byte)
);

const isWebP = (bytes: Uint8Array): boolean => (
  bytes.length >= 12
  && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
  && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
);

export const decodeThemeAssetData = (data: string): Uint8Array => {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error('Theme asset contains invalid base64 data.');
  }
};

export const encodeThemeAssetData = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

export const assertThemeAssetSignature = (
  mediaType: ThemeEmbeddedAsset['mediaType'],
  bytes: Uint8Array,
): void => {
  const valid = mediaType === 'image/png'
    ? bytesStartWith(bytes, PNG_SIGNATURE)
    : mediaType === 'image/webp'
      ? isWebP(bytes)
      : bytesStartWith(bytes, WOFF2_SIGNATURE);
  if (!valid) throw new Error(`Theme asset content does not match ${mediaType}.`);
};

export const calculateThemeAssetSha256 = async (bytes: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This environment cannot verify theme asset integrity.');
  }
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const verifyThemeEmbeddedAsset = async (
  assetId: string,
  asset: ThemeEmbeddedAsset,
): Promise<void> => {
  const bytes = decodeThemeAssetData(asset.data);
  assertThemeAssetSignature(asset.mediaType, bytes);
  const digest = await calculateThemeAssetSha256(bytes);
  if (digest !== asset.sha256.toLowerCase()) {
    throw new Error(`Theme asset ${assetId} failed SHA-256 integrity verification.`);
  }
};

export const verifyThemeAssetLibrary = async (
  assets: Record<string, ThemeEmbeddedAsset> | undefined,
): Promise<void> => {
  for (const [assetId, asset] of Object.entries(assets || {})) {
    await verifyThemeEmbeddedAsset(assetId, asset);
  }
};

export const createThemeEmbeddedAsset = async (
  file: File,
  mediaType: ThemeEmbeddedAsset['mediaType'],
): Promise<ThemeEmbeddedAsset> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertThemeAssetSignature(mediaType, bytes);
  return {
    mediaType,
    data: encodeThemeAssetData(bytes),
    sha256: await calculateThemeAssetSha256(bytes),
  };
};
