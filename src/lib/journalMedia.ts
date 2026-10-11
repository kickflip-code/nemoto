export const JOURNAL_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
export const JOURNAL_MEDIA_PORTFOLIO_WARNING_BYTES = 25 * 1024 * 1024;
export const JOURNAL_MAX_EMBEDDED_IMAGE_BYTES = 3 * 1024 * 1024;

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 2200;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type JournalImageAlignment = 'left' | 'center' | 'right';

export interface JournalImageAttributes {
    src: string;
    alt: string;
    title: string | null;
    caption: string;
    width: string;
    alignment: JournalImageAlignment;
    embeddedSize: number;
}

function filenameToAltText(filename: string): string {
    return filename
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the image file.'));
        reader.readAsDataURL(blob);
    });
}

async function rasterizeImage(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    let maxDimension = MAX_RASTER_DIMENSION;
    let quality = 0.86;

    try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Image processing is not available.');

            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const result = await new Promise<Blob | null>(resolve => {
                canvas.toBlob(resolve, 'image/webp', quality);
            });
            if (!result) throw new Error('Could not optimize the image.');
            if (result.size <= JOURNAL_MAX_EMBEDDED_IMAGE_BYTES) return result;

            maxDimension = Math.max(900, Math.round(maxDimension * 0.74));
            quality = Math.max(0.58, quality - 0.1);
        }
    } finally {
        bitmap.close();
    }

    throw new Error('The optimized image is still larger than 3 MB.');
}

export function isSupportedJournalImage(file: File): boolean {
    return SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase());
}

/**
 * Convert a local image into a portable embedded data URL. Raster images are
 * resized/re-encoded to WebP, which also strips EXIF metadata. GIFs are kept
 * byte-for-byte to preserve animation and therefore use the strict size cap.
 */
export async function prepareJournalImage(file: File): Promise<JournalImageAttributes> {
    if (!isSupportedJournalImage(file)) {
        throw new Error('Use a PNG, JPEG, WebP, or GIF image.');
    }
    if (file.size > MAX_SOURCE_BYTES) {
        throw new Error('The source image is larger than 20 MB.');
    }

    const embeddedBlob = file.type.toLowerCase() === 'image/gif'
        ? file
        : await rasterizeImage(file);
    if (embeddedBlob.size > JOURNAL_MAX_EMBEDDED_IMAGE_BYTES) {
        throw new Error('The embedded image is larger than 3 MB.');
    }

    return {
        src: await blobToDataUrl(embeddedBlob),
        alt: filenameToAltText(file.name),
        title: null,
        caption: '',
        width: '100%',
        alignment: 'center',
        embeddedSize: embeddedBlob.size,
    };
}

export function formatJournalMediaBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function estimateBase64Bytes(base64: string): number {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function estimateEmbeddedJournalMediaBytes(entries: Array<{ content?: string }> | null | undefined): number {
    let total = 0;
    const dataUrlPattern = /src=["']data:image\/[a-z0-9.+-]+;base64,([^"']+)["']/gi;

    (entries || []).forEach(entry => {
        let match: RegExpExecArray | null;
        while ((match = dataUrlPattern.exec(entry.content || '')) !== null) {
            total += estimateBase64Bytes(match[1]);
        }
        dataUrlPattern.lastIndex = 0;
    });

    return total;
}
