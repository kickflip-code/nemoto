import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import type { ThemeRestoreChoice, ThemeRestorePlan } from '../../theme/themeBackup';
import { BUILT_IN_THEME_PRESETS } from '../../theme/presets';
import { AxiomButton, AxiomDialog, AxiomSelect } from '../ui';

export interface PortfolioRestoreDetails {
  name: string;
  sourceSchemaVersion: number;
  sourceAppVersion?: string;
  sourceTimestamp?: string;
  themePlan: ThemeRestorePlan;
  themeChoice: ThemeRestoreChoice;
}

interface PortfolioRestoreDialogProps {
  restore: PortfolioRestoreDetails | null;
  isRestoring: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onThemeChoiceChange: (choice: ThemeRestoreChoice) => void;
}

const themeVersion = (plan: Extract<ThemeRestorePlan, {
  kind: 'custom-install' | 'custom-match' | 'custom-conflict';
}>): string | undefined => {
  const theme = plan.kind === 'custom-match' ? plan.installedTheme : plan.incomingTheme;
  const value = theme.sourceDocument?.themeVersion;
  return typeof value === 'string' ? value : undefined;
};

const formatTimestamp = (value?: string): string => {
  if (!value) return 'Unknown';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown' : timestamp.toLocaleString();
};

const ThemeRestoreSection = ({
  plan,
  choice,
  onChange,
}: {
  plan: ThemeRestorePlan;
  choice: ThemeRestoreChoice;
  onChange: (choice: ThemeRestoreChoice) => void;
}) => {
  if (plan.kind === 'none') {
    return (
      <p className="text-xs leading-relaxed text-text-muted">
        This archive has no appearance snapshot. Your current theme will stay active.
      </p>
    );
  }

  if (plan.kind === 'invalid') {
    return (
      <div className="flex gap-3 rounded-lg border border-accent-warning/20 bg-accent-warning/5 p-3 text-left">
        <AlertTriangle className="mt-0.5 shrink-0 text-accent-warning" size={16} aria-hidden="true" />
        <div>
          <div className="text-xs font-bold text-text-main">Included appearance cannot be restored</div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {plan.message} Portfolio data can still be restored; your current theme will stay active.
          </p>
        </div>
      </div>
    );
  }

  const label = plan.kind === 'built-in'
    ? BUILT_IN_THEME_PRESETS[plan.presetId].label
    : plan.kind === 'custom-match'
      ? plan.installedTheme.label
      : plan.incomingTheme.label;

  return (
    <div className="space-y-2 text-left">
      <div>
        <div className="text-xs font-bold text-text-main">Included appearance</div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {plan.kind === 'built-in' && `${label} · built-in theme`}
          {plan.kind === 'custom-install' && `${label} · custom theme${themeVersion(plan) ? ` · version ${themeVersion(plan)}` : ''}`}
          {plan.kind === 'custom-match' && `${label} · identical theme already installed`}
          {plan.kind === 'custom-conflict' && (
            `Theme ID ${plan.incomingTheme.id} already exists, but its local and backup contents differ. Nemoto will not replace it automatically.`
          )}
        </p>
      </div>
      <label htmlFor="restore-theme-choice" className="block text-[10px] font-bold uppercase tracking-wider text-text-faint">
        Theme handling
      </label>
      <AxiomSelect
        id="restore-theme-choice"
        value={choice}
        onChange={event => onChange(event.target.value as ThemeRestoreChoice)}
        className="axiom-field w-full px-3 py-2 text-xs"
      >
        {plan.kind === 'built-in' && (
          <option value="apply">Activate {label}</option>
        )}
        {plan.kind === 'custom-install' && (
          <option value="apply">Install and activate “{label}”</option>
        )}
        {plan.kind === 'custom-match' && (
          <option value="apply">Activate installed “{label}”</option>
        )}
        {plan.kind === 'custom-conflict' && (
          <>
            <option value="keep-installed">Keep installed “{plan.installedTheme.label}” and activate it (recommended)</option>
            <option value="replace-installed">Replace it with backup copy “{plan.incomingTheme.label}” and activate</option>
          </>
        )}
        <option value="skip">Keep current appearance</option>
      </AxiomSelect>
      {plan.kind === 'custom-conflict' && choice === 'replace-installed' && (
        <p className="text-[10px] leading-relaxed text-accent-warning">
          The local theme file will be replaced. Nemoto retains its previous revision as a recovery copy.
        </p>
      )}
    </div>
  );
};

export default function PortfolioRestoreDialog({
  restore,
  isRestoring,
  onClose,
  onConfirm,
  onThemeChoiceChange,
}: PortfolioRestoreDialogProps) {
  if (!restore) return null;

  return (
    <AxiomDialog
      aria-describedby="portfolio-restore-description"
      aria-labelledby="portfolio-restore-title"
      onClose={() => { if (!isRestoring) onClose(); }}
      closeOnBackdrop={!isRestoring}
      panelClassName="w-full max-w-lg overflow-hidden"
    >
      <div className="axiom-dialog-header flex items-center gap-3 border-b px-5 py-4">
        <div className="axiom-dialog-icon axiom-dialog-icon-warning p-2">
          <RotateCcw size={18} aria-hidden="true" />
        </div>
        <div>
          <h3 id="portfolio-restore-title" className="text-base font-bold text-text-main">Restore portfolio?</h3>
          <p id="portfolio-restore-description" className="mt-0.5 text-xs text-text-muted">
            Validate first, then replace the current Portfolio and handle its appearance explicitly.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="axiom-dialog-panel grid grid-cols-2 gap-3 p-3 text-left text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-faint">Archive</div>
            <div className="mt-1 truncate text-text-main" title={restore.name}>{restore.name}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-faint">Portfolio data version</div>
            <div className="mt-1 text-text-main">{restore.sourceSchemaVersion === 0 ? 'Legacy' : restore.sourceSchemaVersion}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-faint">Created with</div>
            <div className="mt-1 text-text-main">
              {restore.sourceAppVersion ? `Version ${restore.sourceAppVersion}` : 'Version not recorded'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-faint">Exported</div>
            <div className="mt-1 text-text-main">
              {formatTimestamp(restore.sourceTimestamp)}
            </div>
          </div>
        </div>

        <fieldset disabled={isRestoring} className="min-w-0">
        <ThemeRestoreSection
          plan={restore.themePlan}
          choice={restore.themeChoice}
          onChange={onThemeChoiceChange}
        />
        </fieldset>

        <p className="text-[10px] leading-relaxed text-text-faint">
          Nemoto waits for any active save and saves unsaved Portfolio changes before replacement. This working version is retained as portfolio.json.bak. If saving fails, your current work stays open. Installed themes not selected above are untouched.
        </p>
      </div>

      <div className="axiom-dialog-footer flex justify-end gap-3 border-t px-5 py-4">
        <AxiomButton onClick={onClose} disabled={isRestoring}>Cancel</AxiomButton>
        <AxiomButton variant="warning" onClick={onConfirm} disabled={isRestoring}>
          {isRestoring ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
          {isRestoring ? 'Restoring…' : 'Restore'}
        </AxiomButton>
      </div>
    </AxiomDialog>
  );
}
