/**
 * WS-A-4 regression: the role permission editor must load the permissions a
 * role actually holds before it is allowed to overwrite them.
 *
 * `iam.set_role_permissions` replaces a role's grants wholesale. The editor
 * previously seeded its draft from a local cache that was only ever written
 * after a save, so it opened every checkbox unchecked no matter what the role
 * held, and saving submitted a set that omitted everything already granted.
 *
 * These tests assert the three properties that make that impossible:
 *   1. opening the editor shows exactly the stored permissions, pre-checked;
 *   2. the submitted set is the loaded set plus/minus the operator's edit;
 *   3. a failed load disables Save rather than offering an empty draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { I18nProvider } from '../src/shared/i18n';
import { UserManagementSettingsScreen } from '../src/features/settings/UserManagementSettingsScreen';

const ALL_PERMISSIONS = [
  { code: 'VIEW_CUSTOMERS', name: 'View customers' },
  { code: 'MANAGE_INVENTORY', name: 'Manage inventory' },
  { code: 'MANAGE_CATALOG', name: 'Manage catalog' },
  { code: 'MANAGE_USERS', name: 'Manage users' },
];

/** What MANAGER holds in the database for these tests. */
const MANAGER_GRANTS = ['MANAGE_CATALOG', 'MANAGE_INVENTORY'];

interface Options {
  /** Make `list_role_permissions` reject, to exercise the failed-load path. */
  failRolePermissionLoad?: boolean;
  /** Receives the permission set actually submitted to the backend. */
  onSave?: (codes: string[]) => void;
}

function mockBackend({ failRolePermissionLoad = false, onSave }: Options = {}) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case 'list_users':
        return Promise.resolve([]);
      case 'list_roles':
        return Promise.resolve([
          { code: 'MANAGER', name: 'Manager' },
          { code: 'CASHIER', name: 'Cashier' },
        ]);
      case 'list_permissions':
        return Promise.resolve(ALL_PERMISSIONS);
      case 'list_role_permissions':
        if (failRolePermissionLoad) {
          return Promise.reject(new Error('DATABASE_UNAVAILABLE'));
        }
        return Promise.resolve(args.roleCode === 'MANAGER' ? MANAGER_GRANTS : []);
      case 'set_role_permissions':
        onSave?.(args.permissionCodes as string[]);
        return Promise.resolve(null);
      default:
        return Promise.reject(new Error(`unexpected command: ${command}`));
    }
  });
}

function renderScreen() {
  return render(
    <I18nProvider>
      <UserManagementSettingsScreen sessionToken="test-token" />
    </I18nProvider>,
  );
}

async function openManagerEditor() {
  const editButtons = await screen.findAllByRole('button', { name: 'Edit permissions' });
  fireEvent.click(editButtons[0]);
  await screen.findByTestId('permission-grid');
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  window.localStorage.setItem('stockiha.locale', 'en');
});

describe('WS-A-4 role permission editor', () => {
  it('pre-checks exactly the permissions the role currently holds', async () => {
    mockBackend();
    renderScreen();
    await openManagerEditor();

    // The stored grants are checked...
    for (const code of MANAGER_GRANTS) {
      expect(screen.getByTestId(`permission-${code}`)).toBeChecked();
    }
    // ...and nothing else is.
    for (const permission of ALL_PERMISSIONS) {
      if (MANAGER_GRANTS.includes(permission.code)) continue;
      expect(screen.getByTestId(`permission-${permission.code}`)).not.toBeChecked();
    }

    expect(invokeMock).toHaveBeenCalledWith('list_role_permissions', {
      sessionToken: 'test-token',
      roleCode: 'MANAGER',
    });
  });

  it('submits the loaded set plus the newly ticked permission, losing nothing', async () => {
    let submitted: string[] | null = null;
    mockBackend({ onSave: (codes) => (submitted = codes) });
    renderScreen();
    await openManagerEditor();

    fireEvent.click(screen.getByTestId('permission-VIEW_CUSTOMERS'));
    fireEvent.click(screen.getByTestId('submit-role-permissions'));

    await waitFor(() => expect(submitted).not.toBeNull());
    // This is the regression: before the fix the payload was ['VIEW_CUSTOMERS']
    // alone, which would have deleted both grants the role already had.
    expect([...(submitted as unknown as string[])].sort()).toEqual(
      [...MANAGER_GRANTS, 'VIEW_CUSTOMERS'].sort(),
    );
  });

  it('submits the loaded set minus one when a permission is unticked', async () => {
    let submitted: string[] | null = null;
    mockBackend({ onSave: (codes) => (submitted = codes) });
    renderScreen();
    await openManagerEditor();

    fireEvent.click(screen.getByTestId('permission-MANAGE_INVENTORY'));
    fireEvent.click(screen.getByTestId('submit-role-permissions'));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted).toEqual(['MANAGE_CATALOG']);
  });

  it('disables Save and never submits when the current permissions cannot be loaded', async () => {
    let submitted: string[] | null = null;
    mockBackend({ failRolePermissionLoad: true, onSave: (codes) => (submitted = codes) });
    renderScreen();

    const editButtons = await screen.findAllByRole('button', { name: 'Edit permissions' });
    fireEvent.click(editButtons[0]);

    // The grid must not render an all-unchecked draft that looks authoritative.
    await screen.findByTestId('permission-load-failed');
    expect(screen.queryByTestId('permission-grid')).not.toBeInTheDocument();

    const save = screen.getByTestId('submit-role-permissions');
    expect(save).toBeDisabled();

    fireEvent.click(save);
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(submitted).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith('set_role_permissions', expect.anything());
  });
});
