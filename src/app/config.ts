/**
 * Slice 1 — installation-level frontend constants.
 *
 * The MVP targets a single POS workstation. The workstation identity is a
 * free-text key the backend stores in `core.system_state` at bootstrap and
 * uses to scope cash sessions. Since no backend command returns that stored
 * value, the frontend uses this fixed constant consistently for login,
 * cash-session, and dashboard calls, and prefills the setup form with it so
 * the value the admin confirms matches what the app then uses. A future
 * multi-workstation feature would persist/return this per device.
 */
export const WORKSTATION_ID = 'POS-1';
