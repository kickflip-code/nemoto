export function formatError(error: any): string {
    if (error && typeof error === 'object' && 'message' in error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Unknown error occurred';
}
