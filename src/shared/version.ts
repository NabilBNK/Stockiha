/**
 * The build marker shown in the UI so manual Windows testing can tell which
 * build is actually running.
 *
 * Defined once and rendered in two places on purpose. It was previously only
 * on the dashboard — which is unreachable when first-run setup fails, the
 * exact situation in which "is this the new build?" most needs answering.
 * A failed install round trip was spent on that ambiguity, so the setup
 * screen shows it too.
 */
export const APP_VERSION_MARKER = 'WS-K-6.2';
