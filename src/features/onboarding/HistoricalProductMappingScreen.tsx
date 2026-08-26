import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HistoricalProductAliasDecisionInput,
  HistoricalProductMappingDecision,
  HistoricalProductMappingResult,
  HistoricalProductMappingRow,
  HistoricalProductMappingSuggestion,
} from '../../shared/ipc/onboardingDto';
import {
  applyHistoricalProductAliasDecisions,
  getHistoricalProductMapping,
} from '../../shared/ipc/onboardingGateway';
import { MergeTargetCombobox, type MergeTargetOption } from './MergeTargetCombobox';
import {
  SUGGESTION_MAX_DISTANCE,
  describeRawVariant,
  formatExactDzd,
  suggestGroupings,
} from './productMapping';

interface Props {
  sessionToken: string;
  batchId: number;
}

const DECISION_LABEL: Record<HistoricalProductMappingDecision, string> = {
  CANONICAL: 'Article confirmé',
  MERGED: 'Regroupé avec un autre',
  NEW_PRODUCT: 'Nouvel article',
  IGNORED: 'Ignoré dans les rapports',
};

function describeRow(row: HistoricalProductMappingRow): string {
  return describeRawVariant({
    productName: row.displayProductName,
    brand: row.displayBrand,
    customDetails: row.displayCustomDetails,
  });
}

/**
 * WS-G — the screen on which the administrator resolves every distinct
 * historical description into a canonical article, ONCE, before any report is
 * computed.
 *
 * Two things this screen deliberately does NOT do:
 *   - it never merges anything on its own. A proposal stays a proposal until
 *     the administrator presses the button next to it;
 *   - it never rewrites the transcription. The lines stay exactly as they were
 *     typed from the paper book; only the grouping is recorded.
 */
export function HistoricalProductMappingScreen({ sessionToken, batchId }: Props) {
  const [mapping, setMapping] = useState<HistoricalProductMappingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getHistoricalProductMapping(sessionToken, { batchId });
      setMapping(result);
      setMessage(null);
    } catch {
      setMessage(
        "La liste des articles du cahier n'a pas pu être chargée. Réessayez, et prévenez votre responsable si le problème persiste.",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionToken, batchId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = useMemo(() => mapping?.descriptions ?? [], [mapping]);

  const suggestions = useMemo(() => suggestGroupings(rows), [rows]);

  const fuzzySuggestions = useMemo(
    () => suggestions.filter((item) => item.kind === 'FUZZY'),
    [suggestions],
  );

  const byKey = useMemo(() => {
    const index = new Map<string, HistoricalProductMappingRow>();
    for (const row of rows) index.set(row.normalizedKey, row);
    return index;
  }, [rows]);

  /** The proposal attached to a row, so it can be shown next to it. */
  const suggestionFor = useMemo(() => {
    const index = new Map<string, HistoricalProductMappingSuggestion>();
    for (const item of fuzzySuggestions) {
      if (!index.has(item.normalizedKey)) index.set(item.normalizedKey, item);
    }
    return index;
  }, [fuzzySuggestions]);

  const visibleRows = useMemo(
    () => (onlyUnresolved ? rows.filter((row) => !row.isResolved) : rows),
    [rows, onlyUnresolved],
  );

  const applyDecisions = useCallback(
    async (decisions: HistoricalProductAliasDecisionInput[]) => {
      if (decisions.length === 0) return;
      setBusy(true);
      try {
        await applyHistoricalProductAliasDecisions(sessionToken, { decisions });
        await reload();
        setMessage(
          decisions.length === 1
            ? 'Votre choix a été enregistré.'
            : `${decisions.length} choix ont été enregistrés.`,
        );
      } catch {
        setMessage(
          "Votre choix n'a pas pu être enregistré. Vérifiez que l'article de destination existe bien, puis réessayez.",
        );
      } finally {
        setBusy(false);
      }
    },
    [sessionToken, reload],
  );

  /**
   * The full candidate list, built once instead of per row. Every description
   * is a possible destination; the row itself is removed at render time.
   *
   * There is deliberately NO "confirm every proposal at once" button: a wrong
   * merge silently fuses two real articles and corrupts their cost, so each one
   * is confirmed on its own row.
   */
  const allOptions = useMemo<MergeTargetOption[]>(
    () => rows.map((row) => ({ value: row.normalizedKey, label: describeRow(row) })),
    [rows],
  );

  if (loading) {
    return <p className="sk-muted">Chargement des articles du cahier…</p>;
  }

  if (!mapping) {
    return <p className="sk-muted">{message ?? 'Aucun article à afficher.'}</p>;
  }

  const readiness = mapping.readiness;
  const gateTone = readiness.isComplete
    ? 'success'
    : readiness.sellWithoutCostSourceCount > 0
      ? 'danger'
      : 'warning';

  return (
    <div className="sk-section-block" data-testid="historical-product-mapping">
      <h3 className="sk-subsection-title">Regrouper les articles du cahier</h3>
      <p className="sk-muted">
        Chaque façon d&apos;écrire un article dans le cahier est listée ci-dessous. Dites pour
        chacune s&apos;il s&apos;agit d&apos;un article à part entière, ou de la même chose
        écrite autrement. Rien n&apos;est regroupé sans votre accord, et le cahier recopié
        n&apos;est jamais modifié.
      </p>

      {/* ---- the readiness gate ------------------------------------------ */}
      <div className={`sk-callout sk-callout--${gateTone}`} data-testid="mapping-readiness">
        <p>
          <strong>
            {readiness.isComplete
              ? 'Le regroupement est terminé : les rapports peuvent être calculés.'
              : 'Le regroupement n’est pas encore terminé.'}
          </strong>
        </p>
        <ul>
          <li>
            {readiness.unresolvedDescriptionCount} façon(s) d&apos;écrire sur{' '}
            {readiness.distinctDescriptionCount} n&apos;ont pas encore été confirmées.
          </li>
          <li>
            {readiness.sellWithoutCostSourceCount === 0 ? (
              <>Chaque article vendu a un prix d&apos;achat correspondant dans le cahier.</>
            ) : (
              <>
                <strong>
                  {readiness.sellWithoutCostSourceCount} article(s) vendu(s) n&apos;ont aucun achat
                  correspondant
                </strong>{' '}
                ({formatExactDzd(readiness.sellWithoutCostSourceValueDzd)} DA de ventes). Tant que
                c&apos;est le cas, le bénéfice affiché sur ces ventes serait trop élevé, car aucun
                prix d&apos;achat n&apos;est trouvé.
              </>
            )}
          </li>
          <li>
            {readiness.distinctCanonicalVariantsSold} article(s) différent(s) vendu(s) après
            regroupement.
          </li>
        </ul>
      </div>

      {message && <p className="sk-muted">{message}</p>}

      {/* ---- proposals ---------------------------------------------------- */}
      {fuzzySuggestions.length > 0 && (
        <div className="sk-section-block" data-testid="mapping-suggestions">
          <h4 className="sk-subsection-title">
            Regroupements proposés ({fuzzySuggestions.length})
          </h4>
          <p className="sk-muted">
            Ces écritures se ressemblent à {SUGGESTION_MAX_DISTANCE} caractère(s) près et
            désignent la même taille. Ce ne sont que des propositions : rien n&apos;est regroupé
            tant que vous ne l&apos;avez pas confirmé.
          </p>
          <div className="sk-table-wrapper">
            <table className="sk-table">
              <thead>
                <tr>
                  <th scope="col">Écrit dans le cahier</th>
                  <th scope="col">Serait la même chose que</th>
                  <th scope="col">Écart</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {fuzzySuggestions.map((item) => {
                  const source = byKey.get(item.normalizedKey);
                  const target = byKey.get(item.suggestedCanonicalKey);
                  return (
                    <tr key={`${item.normalizedKey}->${item.suggestedCanonicalKey}`}>
                      <td>{source ? describeRow(source) : item.normalizedKey}</td>
                      <td>{target ? describeRow(target) : item.suggestedCanonicalKey}</td>
                      <td className="sk-num">{item.distance}</td>
                      <td>
                        <button
                          type="button"
                          className="sk-button sk-button--secondary"
                          disabled={busy}
                          onClick={() =>
                            void applyDecisions([
                              {
                                normalizedKey: item.normalizedKey,
                                rawSample: source ? describeRow(source) : item.normalizedKey,
                                decision: 'MERGED',
                                canonicalKey: item.suggestedCanonicalKey,
                              },
                            ])
                          }
                        >
                          Regrouper
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sk-muted">
            Confirmez-les un par un : un regroupement fait par erreur mélangerait deux articles
            réellement différents, et fausserait leur prix de revient.
          </p>
        </div>
      )}

      {/* ---- every distinct description ----------------------------------- */}
      <label className="sk-checkbox-row">
        <input
          type="checkbox"
          checked={onlyUnresolved}
          onChange={(event) => setOnlyUnresolved(event.target.checked)}
        />
        <span>N&apos;afficher que ce qui reste à confirmer</span>
      </label>

      <div className="sk-table-wrapper">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">Article écrit dans le cahier</th>
              <th scope="col">Lignes</th>
              <th scope="col">Quantité</th>
              <th scope="col">Valeur (DA)</th>
              <th scope="col">Achats / ventes</th>
              <th scope="col">Décision</th>
              <th scope="col">Que faire</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const suggestion = suggestionFor.get(row.normalizedKey);
              const selectedTarget =
                mergeTarget[row.normalizedKey] ?? suggestion?.suggestedCanonicalKey ?? '';
              const missingCost = row.appearsInSell && !row.hasCostSource;
              return (
                <tr key={row.normalizedKey} className={missingCost ? 'sk-row--danger' : undefined}>
                  <td>
                    <div>{describeRow(row)}</div>
                    {row.rawVariants.length > 1 && (
                      <div className="sk-muted">
                        Aussi écrit :{' '}
                        {row.rawVariants
                          .slice(1)
                          .map((variant) => describeRawVariant(variant))
                          .join(' / ')}
                      </div>
                    )}
                    {missingCost && (
                      <div className="sk-badge sk-badge--danger">
                        Vendu sans achat correspondant
                      </div>
                    )}
                  </td>
                  <td className="sk-num">{row.occurrenceCount}</td>
                  <td className="sk-num">{formatExactDzd(row.totalQuantity)}</td>
                  <td className="sk-num">{formatExactDzd(row.totalValueDzd)}</td>
                  <td>
                    {row.appearsInBuy && row.appearsInSell
                      ? 'Acheté et vendu'
                      : row.appearsInBuy
                        ? 'Acheté seulement'
                        : 'Vendu seulement'}
                  </td>
                  <td>
                    {row.decision ? (
                      <span className="sk-badge sk-badge--info">
                        {DECISION_LABEL[row.decision]}
                      </span>
                    ) : (
                      <span className="sk-badge sk-badge--warning">À confirmer</span>
                    )}
                  </td>
                  <td>
                    <div className="sk-filter-row">
                      <button
                        type="button"
                        className="sk-button sk-button--secondary"
                        disabled={busy}
                        onClick={() =>
                          void applyDecisions([
                            {
                              normalizedKey: row.normalizedKey,
                              rawSample: describeRow(row),
                              decision: 'CANONICAL',
                            },
                          ])
                        }
                      >
                        C&apos;est un article à part
                      </button>
                      <button
                        type="button"
                        className="sk-button sk-button--secondary"
                        disabled={busy}
                        onClick={() =>
                          void applyDecisions([
                            {
                              normalizedKey: row.normalizedKey,
                              rawSample: describeRow(row),
                              decision: 'NEW_PRODUCT',
                            },
                          ])
                        }
                      >
                        Nouvel article
                      </button>
                      <button
                        type="button"
                        className="sk-button sk-button--secondary"
                        disabled={busy}
                        onClick={() =>
                          void applyDecisions([
                            {
                              normalizedKey: row.normalizedKey,
                              rawSample: describeRow(row),
                              decision: 'IGNORED',
                            },
                          ])
                        }
                      >
                        Ignorer
                      </button>
                    </div>
                    <div className="sk-filter-row">
                      <MergeTargetCombobox
                        label={`Regrouper « ${describeRow(row)} » avec`}
                        placeholder="Regrouper avec… (tapez pour chercher)"
                        options={allOptions.filter(
                          (option) => option.value !== row.normalizedKey,
                        )}
                        value={selectedTarget}
                        disabled={busy}
                        onChange={(next) =>
                          setMergeTarget((current) => ({
                            ...current,
                            [row.normalizedKey]: next,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="sk-button sk-button--secondary"
                        disabled={busy || selectedTarget === ''}
                        onClick={() =>
                          void applyDecisions([
                            {
                              normalizedKey: row.normalizedKey,
                              rawSample: describeRow(row),
                              decision: 'MERGED',
                              canonicalKey: selectedTarget,
                            },
                          ])
                        }
                      >
                        Regrouper
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
