import { beforeEach, expect, it, vi } from 'vitest';
import { exportRecordReport } from './contextualRecordReportExport';

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mocks.write }));
beforeEach(() => { vi.resetAllMocks(); });
it('writes the exact report to the chosen text file', async () => {
    mocks.save.mockResolvedValue('C:/Reports/actions.txt');
    expect(await exportRecordReport('Åtgärder\nDone\n')).toBe(true);
    expect(mocks.write).toHaveBeenCalledWith('C:/Reports/actions.txt', 'Åtgärder\nDone\n');
});
it('does not write after cancellation and propagates write failures', async () => {
    mocks.save.mockResolvedValue(null);
    expect(await exportRecordReport('report')).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue('C:/Reports/actions.txt');
    mocks.write.mockRejectedValue(new Error('Disk full'));
    await expect(exportRecordReport('report')).rejects.toThrow('Disk full');
});
