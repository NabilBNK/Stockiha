/**
 * WS-D-3 — Catalogue Setup screen: three tabs (Categories, Attributes,
 * Units) over the D-2 reference-data lifecycle gateway calls. Loading/
 * error/empty-state handling follows the pattern in
 * src/features/settings/InventoryCorrectionsSettingsScreen.tsx.
 *
 * WS-D-CORRECTION-1: Brand was removed as a product-level reference type
 * (its own tab/table) — it is now an ordinary variant-level Attribute,
 * created through the Attributes tab below like any other (e.g. Color,
 * Size). No Brand-specific UI remains here.
 */
import { useEffect, useState } from 'react';

import { Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { AttributesManager } from './AttributesManager';
import { CodedReferenceManager } from './CodedReferenceManager';
import { SimpleReferenceManager } from './SimpleReferenceManager';
import { useCatalogueSetup } from './useCatalogueSetup';

type Tab = 'categories' | 'attributes' | 'units';

export function CatalogueSetupScreen({ sessionToken }: { sessionToken: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('categories');

  const setup = useCatalogueSetup(sessionToken);
  const {
    categories, categoriesLoading, categoriesError,
    units, unitsLoading, unitsError,
    attributes, attributeValues, attributesLoading, attributesError,
    loadAll,
    createCategory, renameCategory, setCategoryActive, deleteCategory,
    createUnit, renameUnit, setUnitActive, deleteUnit,
    createAttribute, renameAttribute, setAttributeActive, deleteAttribute,
    addAttributeValue, renameAttributeValue, setAttributeValueActive, deleteAttributeValue,
  } = setup;

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const initialLoading =
    categoriesLoading && unitsLoading && attributesLoading
    && categories.length === 0 && units.length === 0 && attributes.length === 0;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'categories', label: t('catalogueSetup.tabs.categories') },
    { key: 'attributes', label: t('catalogueSetup.tabs.attributes') },
    { key: 'units', label: t('catalogueSetup.tabs.units') },
  ];

  return (
    <section className="sk-page" data-testid="catalogue-setup-screen">
      <div className="sk-dashboard__header">
        <div>
          <h1>{t('catalogueSetup.title')}</h1>
          <p>{t('catalogueSetup.subtitle')}</p>
        </div>
      </div>

      <nav
        className="sk-view-switcher"
        role="tablist"
        aria-label={t('catalogueSetup.title')}
        data-testid="catalogue-setup-tabs"
      >
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`sk-view-switcher__item ${tab === item.key ? 'sk-view-switcher__item--active' : ''}`}
            onClick={() => setTab(item.key)}
            data-testid={`catalogue-setup-tab-${item.key}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {initialLoading ? (
        <Spinner />
      ) : (
        <div className="sk-screen__content">
          {tab === 'categories' && (
            <SimpleReferenceManager
              items={categories}
              loading={categoriesLoading}
              error={categoriesError}
              nameLabel={t('catalogueSetup.categories.name')}
              createLabel={t('catalogueSetup.categories.create')}
              emptyText={t('catalogueSetup.categories.empty')}
              onCreate={createCategory}
              onRename={renameCategory}
              onToggleActive={setCategoryActive}
              onDelete={deleteCategory}
            />
          )}
          {tab === 'attributes' && (
            <AttributesManager
              attributes={attributes}
              attributeValues={attributeValues}
              loading={attributesLoading}
              error={attributesError}
              onCreateAttribute={createAttribute}
              onRenameAttribute={renameAttribute}
              onToggleAttributeActive={setAttributeActive}
              onDeleteAttribute={deleteAttribute}
              onAddValue={addAttributeValue}
              onRenameValue={renameAttributeValue}
              onToggleValueActive={setAttributeValueActive}
              onDeleteValue={deleteAttributeValue}
            />
          )}
          {tab === 'units' && (
            <CodedReferenceManager
              items={units}
              loading={unitsLoading}
              error={unitsError}
              codeLabel={t('catalogueSetup.units.code')}
              nameLabel={t('catalogueSetup.units.name')}
              createLabel={t('catalogueSetup.units.create')}
              emptyText={t('catalogueSetup.units.empty')}
              onCreate={createUnit}
              onRename={renameUnit}
              onToggleActive={setUnitActive}
              onDelete={deleteUnit}
            />
          )}
        </div>
      )}
    </section>
  );
}
