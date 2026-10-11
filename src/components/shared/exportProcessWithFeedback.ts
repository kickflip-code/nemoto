import { toast } from 'sonner';
import { BackupService } from '../../services/BackupService';
import { formatError } from '../../lib/errorUtils';

/** Shared by the Export dialog and process context menu. */
export async function exportProcessWithFeedback(processId: string, includeDependencies = true, includeLinkedRecords = false): Promise<boolean> {
    const toastId = toast.loading('Preparing process export...');
    try {
        const saved = await BackupService.downloadPartialExport(processId, includeDependencies, includeLinkedRecords);
        if (saved) toast.success('Process export saved', { id: toastId });
        else toast.dismiss(toastId);
        return saved;
    } catch (error) {
        toast.error(`Failed to export process: ${formatError(error)}. Check the destination and try again.`, { id: toastId });
        return false;
    }
}
