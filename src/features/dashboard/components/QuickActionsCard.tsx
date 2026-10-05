import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import { QUICK_ACTIONS, resolveTarget } from '../quickActions';

interface QuickActionsCardProps {
  access: NavAccess;
  onNavigate: (view: AppView) => void;
}

export function QuickActionsCard({ access, onNavigate }: QuickActionsCardProps) {
  const { t } = useI18n();

  const visibleActions = QUICK_ACTIONS.map((action) => ({
    ...action,
    target: resolveTarget(action.purposes, access),
  })).filter((item): item is typeof item & { target: AppView } => item.target !== null);

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className="sk-card sk-dash-card sk-dash-actions-card">
      <div className="sk-dash-card__header">
        <h3 className="sk-dash-card__title">{t('dash.actions.title')}</h3>
      </div>
      <div className="sk-dash-actions__grid">
        {visibleActions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="secondary"
            className="sk-dash-action-btn"
            onClick={() => onNavigate(action.target)}
          >
            <span className="sk-dash-action-icon" aria-hidden>
              {action.icon}
            </span>
            <span className="sk-dash-action-label">{t(action.labelKey)}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
