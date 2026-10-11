import { savePluginText } from './pluginTextOutput';

export async function exportRecordReport(text: string): Promise<boolean> {
    const result = await savePluginText(`axiom-tasks-${new Date().toISOString().slice(0, 10)}`, text);
    return result.status === 'saved';
}
