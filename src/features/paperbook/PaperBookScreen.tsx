import React, { useState } from 'react';
import { useTranslation } from '../../shared/i18n';
import { RecordsTab } from './RecordsTab';
import { ImportTab } from './ImportTab';
import { NamesTab } from './NamesTab';
import { AnalyticsTab } from './AnalyticsTab';
import './paperbook.css';

interface Props {
  sessionToken: string;
}

type TabKey = 'analytics' | 'records' | 'import' | 'names';

export const PaperBookScreen: React.FC<Props> = ({ sessionToken }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('analytics');

  return (
    <div className="sk-paperbook-page">
      {/* Header */}
      <div className="sk-paperbook-header">
        <div className="sk-paperbook-header__info">
          <h1>{t('paperbook.title')}</h1>
          <p>{t('paperbook.subtitle')}</p>
        </div>
      </div>

      {/* Strict Historical Isolation Banner */}
      <div className="sk-paperbook-banner">
        <div className="sk-paperbook-banner__icon">🔒</div>
        <div>
          <strong>{t('paperbook.banner.title')}</strong>
          <span>{t('paperbook.banner.desc')}</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="sk-paperbook-tabs">
        <button
          type="button"
          className={`sk-paperbook-tab-btn ${activeTab === 'analytics' ? 'sk-paperbook-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          📊 {t('paperbook.tab.analytics')}
        </button>

        <button
          type="button"
          className={`sk-paperbook-tab-btn ${activeTab === 'records' ? 'sk-paperbook-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('records')}
        >
          📋 {t('paperbook.tab.records')}
        </button>

        <button
          type="button"
          className={`sk-paperbook-tab-btn ${activeTab === 'import' ? 'sk-paperbook-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          📥 {t('paperbook.tab.import')}
        </button>

        <button
          type="button"
          className={`sk-paperbook-tab-btn ${activeTab === 'names' ? 'sk-paperbook-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('names')}
        >
          🏷️ {t('paperbook.tab.names')}
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'analytics' && <AnalyticsTab sessionToken={sessionToken} />}
      {activeTab === 'records' && <RecordsTab sessionToken={sessionToken} />}
      {activeTab === 'import' && (
        <ImportTab
          sessionToken={sessionToken}
          onImportSuccess={() => {
            setActiveTab('records');
          }}
        />
      )}
      {activeTab === 'names' && <NamesTab sessionToken={sessionToken} />}
    </div>
  );
};
