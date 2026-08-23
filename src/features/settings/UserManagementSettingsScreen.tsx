/**
 * WS-A — User & Role administration surface.
 *
 * This screen is presentation and orchestration only. Every operation it offers
 * is authorized inside PostgreSQL: each `iam.*` function resolves the caller
 * from the opaque session token (`iam.resolve_session_with_permission`) and
 * checks `MANAGE_USERS` / `MANAGE_ROLES` before mutating. Hiding a card here is
 * a usability affordance, never the security boundary — a caller that bypasses
 * the UI still gets `42501` from the database.
 *
 * The two cards gate independently because the permissions are independent:
 * `MANAGE_USERS` governs accounts, `MANAGE_ROLES` governs the role catalogue.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button, Banner, Spinner, TextField, ConfirmDialog } from '../../shared/components';
import { useErrorText, codeForError } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type { UserSnapshot, RoleSnapshot, PermissionSnapshot } from '../../shared/ipc/iamDto';
import {
  listUsers,
  createUser,
  setUserActive,
  assignUserRole,
  listRoles,
  listPermissions,
  listRolePermissions,
  createRole,
  setRolePermissions,
} from '../../shared/ipc/iamGateway';

interface Props {
  sessionToken: string;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'User Management',
    subtitle: 'Manage user accounts and their assigned role.',
    createUser: 'Create user',
    username: 'Username',
    displayName: 'Display name',
    role: 'Role',
    status: 'Status',
    actions: 'Actions',
    active: 'Active',
    inactive: 'Inactive',
    activate: 'Activate',
    deactivate: 'Deactivate',
    assignRole: 'Change role',
    save: 'Save',
    cancel: 'Cancel',
    password: 'Password',
    noRole: 'No role',
    empty: 'No users found.',
    deactivateConfirmTitle: 'Deactivate user',
    deactivateConfirmBody:
      'This user will be signed out immediately and will not be able to log in again until reactivated.',
    userCreated: 'User created.',
    userUpdated: 'User updated.',
    rolesTitle: 'Roles & Permissions',
    rolesSubtitle: 'Create roles and choose which permissions each one grants.',
    createRole: 'Create role',
    roleCode: 'Role code',
    roleCodeHelp: 'Uppercase letters, digits and underscores. Must start with a letter.',
    roleName: 'Role name',
    permissions: 'Permissions',
    editPermissions: 'Edit permissions',
    roleCreated: 'Role created.',
    permissionsUpdated: 'Role permissions updated.',
    permissionsLoading: 'Loading current permissions...',
    permissionsLoadFailed:
      'Could not load the permissions this role currently holds. Saving is disabled, because saving now would remove them.',
    permissionCount: 'permissions',
    superAdminLocked: 'The SUPER_ADMIN role always holds every permission and cannot be edited.',
  },
  fr: {
    title: 'Gestion des utilisateurs',
    subtitle: 'Gérer les comptes utilisateurs et le rôle qui leur est attribué.',
    createUser: 'Créer un utilisateur',
    username: 'Nom d’utilisateur',
    displayName: 'Nom d’affichage',
    role: 'Rôle',
    status: 'Statut',
    actions: 'Actions',
    active: 'Actif',
    inactive: 'Inactif',
    activate: 'Activer',
    deactivate: 'Désactiver',
    assignRole: 'Changer le rôle',
    save: 'Enregistrer',
    cancel: 'Annuler',
    password: 'Mot de passe',
    noRole: 'Aucun rôle',
    empty: 'Aucun utilisateur trouvé.',
    deactivateConfirmTitle: 'Désactiver l’utilisateur',
    deactivateConfirmBody:
      'Cet utilisateur sera déconnecté immédiatement et ne pourra plus se connecter jusqu’à sa réactivation.',
    userCreated: 'Utilisateur créé.',
    userUpdated: 'Utilisateur mis à jour.',
    rolesTitle: 'Rôles et permissions',
    rolesSubtitle: 'Créer des rôles et choisir les permissions accordées par chacun.',
    createRole: 'Créer un rôle',
    roleCode: 'Code du rôle',
    roleCodeHelp: 'Lettres majuscules, chiffres et tirets bas. Doit commencer par une lettre.',
    roleName: 'Nom du rôle',
    permissions: 'Permissions',
    editPermissions: 'Modifier les permissions',
    roleCreated: 'Rôle créé.',
    permissionsUpdated: 'Permissions du rôle mises à jour.',
    permissionsLoading: 'Chargement des permissions actuelles...',
    permissionsLoadFailed:
      'Impossible de charger les permissions actuelles de ce rôle. L’enregistrement est désactivé, car il les supprimerait.',
    permissionCount: 'permissions',
    superAdminLocked:
      'Le rôle SUPER_ADMIN détient toujours toutes les permissions et n’est pas modifiable.',
  },
  ar: {
    title: 'إدارة المستخدمين',
    subtitle: 'إدارة حسابات المستخدمين والدور المعيَّن لكل منهم.',
    createUser: 'إنشاء مستخدم',
    username: 'اسم المستخدم',
    displayName: 'الاسم المعروض',
    role: 'الدور',
    status: 'الحالة',
    actions: 'إجراءات',
    active: 'نشط',
    inactive: 'غير نشط',
    activate: 'تفعيل',
    deactivate: 'تعطيل',
    assignRole: 'تغيير الدور',
    save: 'حفظ',
    cancel: 'إلغاء',
    password: 'كلمة المرور',
    noRole: 'بدون دور',
    empty: 'لا يوجد مستخدمون.',
    deactivateConfirmTitle: 'تعطيل المستخدم',
    deactivateConfirmBody:
      'سيتم تسجيل خروج هذا المستخدم فوراً ولن يتمكن من تسجيل الدخول حتى إعادة تفعيله.',
    userCreated: 'تم إنشاء المستخدم.',
    userUpdated: 'تم تحديث المستخدم.',
    rolesTitle: 'الأدوار والصلاحيات',
    rolesSubtitle: 'إنشاء الأدوار وتحديد الصلاحيات التي يمنحها كل دور.',
    createRole: 'إنشاء دور',
    roleCode: 'رمز الدور',
    roleCodeHelp: 'أحرف كبيرة وأرقام وشرطة سفلية، ويجب أن يبدأ بحرف.',
    roleName: 'اسم الدور',
    permissions: 'الصلاحيات',
    editPermissions: 'تعديل الصلاحيات',
    roleCreated: 'تم إنشاء الدور.',
    permissionsUpdated: 'تم تحديث صلاحيات الدور.',
    permissionsLoading: 'جارٍ تحميل الصلاحيات الحالية...',
    permissionsLoadFailed:
      'تعذر تحميل الصلاحيات الحالية لهذا الدور. تم تعطيل الحفظ لأنه سيؤدي إلى حذفها.',
    permissionCount: 'صلاحية',
    superAdminLocked: 'دور SUPER_ADMIN يملك جميع الصلاحيات دائماً ولا يمكن تعديله.',
  },
};

/** Mirrors the `^[A-Z][A-Z0-9_]*$` check inside `iam.create_role`. */
const ROLE_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

const PERMISSION_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '6px',
  maxHeight: '320px',
  overflowY: 'auto',
};

export function UserManagementSettingsScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();

  const [users, setUsers] = useState<UserSnapshot[]>([]);
  const [roles, setRoles] = useState<RoleSnapshot[]>([]);
  const [permissions, setPermissions] = useState<PermissionSnapshot[] | null>(null);
  // The editor replaces a role's grants wholesale, so it must know the current
  // set before it may submit one. These two track that load; until it succeeds
  // the draft is not a faithful picture of the role and must not be saved.
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsLoadFailed, setPermissionsLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [canManageUsers, setCanManageUsers] = useState(true);
  const [busy, setBusy] = useState(false);

  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [isAssignRoleOpen, setIsAssignRoleOpen] = useState(false);
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleSnapshot | null>(null);

  const [targetUser, setTargetUser] = useState<UserSnapshot | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<UserSnapshot | null>(null);

  const [formUsername, setFormUsername] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRoleCode, setFormRoleCode] = useState('');
  const [assignRoleCode, setAssignRoleCode] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);

  const canManageRoles = permissions !== null;

  const refreshUsers = useCallback(async () => {
    setUsers(await listUsers(sessionToken));
  }, [sessionToken]);

  const refreshRoles = useCallback(async () => {
    setRoles(await listRoles(sessionToken));
  }, [sessionToken]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // MANAGE_USERS gates the whole screen; MANAGE_ROLES only the second card,
    // so the permission catalogue is loaded independently and a denial there is
    // an expected outcome rather than an error.
    Promise.all([listUsers(sessionToken), listRoles(sessionToken)])
      .then(([usersData, rolesData]) => {
        if (cancelled) return;
        setUsers(usersData);
        setRoles(rolesData);
        return listPermissions(sessionToken)
          .then((permissionsData) => {
            if (!cancelled) setPermissions(permissionsData);
          })
          .catch((err) => {
            if (!cancelled && codeForError(err) !== 'PERMISSION_DENIED') {
              setError(errorText(err));
            }
          });
      })
      .catch((err) => {
        if (cancelled) return;
        if (codeForError(err) === 'PERMISSION_DENIED') {
          setCanManageUsers(false);
        } else {
          setError(errorText(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken, errorText]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await operation();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function handleCreateUser(event: React.FormEvent) {
    event.preventDefault();
    void run(async () => {
      await createUser(sessionToken, formUsername, formPassword, formDisplayName, formRoleCode);
      await refreshUsers();
      setIsCreateUserOpen(false);
      setFormUsername('');
      setFormDisplayName('');
      setFormPassword('');
      setFormRoleCode('');
      setFeedback(text.userCreated);
    });
  }

  function handleAssignRole(event: React.FormEvent) {
    event.preventDefault();
    if (!targetUser) return;
    void run(async () => {
      await assignUserRole(sessionToken, targetUser.user_id, assignRoleCode);
      await refreshUsers();
      setIsAssignRoleOpen(false);
      setTargetUser(null);
      setFeedback(text.userUpdated);
    });
  }

  function handleSetActive(user: UserSnapshot, isActive: boolean) {
    void run(async () => {
      await setUserActive(sessionToken, user.user_id, isActive);
      await refreshUsers();
      setPendingDeactivation(null);
      setFeedback(text.userUpdated);
    });
  }

  function handleCreateRole(event: React.FormEvent) {
    event.preventDefault();
    void run(async () => {
      await createRole(sessionToken, newRoleCode, newRoleName);
      await refreshRoles();
      setIsCreateRoleOpen(false);
      setNewRoleCode('');
      setNewRoleName('');
      setFeedback(text.roleCreated);
    });
  }

  function openPermissionEditor(role: RoleSnapshot) {
    setEditingRole(role);
    // Open with an empty draft but flagged as loading, never as a real answer:
    // an unloaded editor previously rendered every box unchecked and looked
    // identical to a role that genuinely holds nothing.
    setDraftPermissions([]);
    setPermissionsLoadFailed(false);
    setPermissionsLoading(true);
    void listRolePermissions(sessionToken, role.code)
      .then((current) => {
        setDraftPermissions(current);
        setPermissionsLoading(false);
      })
      .catch((err) => {
        // Deliberately not a silent empty draft. Saving from a failed load
        // would submit an empty set and delete every grant the role holds.
        setPermissionsLoading(false);
        setPermissionsLoadFailed(true);
        if (codeForError(err) !== 'PERMISSION_DENIED') setError(errorText(err));
      });
  }

  function handleSavePermissions(event: React.FormEvent) {
    event.preventDefault();
    if (!editingRole) return;
    // Belt and braces: the submit control is already disabled in both states.
    if (permissionsLoading || permissionsLoadFailed) return;
    const role = editingRole;
    void run(async () => {
      await setRolePermissions(sessionToken, role.code, draftPermissions);
      setEditingRole(null);
      setFeedback(text.permissionsUpdated);
    });
  }

  if (!canManageUsers) return null;

  const roleCodeInvalid = newRoleCode.length > 0 && !ROLE_CODE_RE.test(newRoleCode);

  return (
    <section className="sk-page" data-testid="user-management-settings">
      <div className="sk-card">
        <h2 id="user-management-title">{text.title}</h2>
        <p>{text.subtitle}</p>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-stack">
          <Button
            type="button"
            data-testid="open-create-user"
            onClick={() => setIsCreateUserOpen(true)}
            disabled={busy || loading}
          >
            {text.createUser}
          </Button>
        </div>

        {loading ? (
          <Spinner />
        ) : users.length === 0 ? (
          <p className="sk-field-help">{text.empty}</p>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="user-management-table">
              <thead>
                <tr>
                  <th>{text.username}</th>
                  <th>{text.displayName}</th>
                  <th>{text.role}</th>
                  <th>{text.status}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id} data-testid={`user-row-${user.username}`}>
                    <td>
                      <strong>{user.username}</strong>
                    </td>
                    <td>{user.display_name}</td>
                    <td>
                      {user.role_names.length === 0 ? (
                        <span className="sk-badge sk-badge--muted">{text.noRole}</span>
                      ) : (
                        <div className="sk-stack">
                          {user.role_names.map((name, index) => (
                            <span key={user.role_codes[index] ?? name} className="sk-badge sk-badge--info">
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`sk-badge ${user.is_active ? 'sk-badge--ok' : 'sk-badge--danger'}`}
                      >
                        {user.is_active ? text.active : text.inactive}
                      </span>
                    </td>
                    <td>
                      <div className="sk-stack">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            setTargetUser(user);
                            setAssignRoleCode(user.role_codes[0] ?? '');
                            setIsAssignRoleOpen(true);
                          }}
                        >
                          {text.assignRole}
                        </Button>
                        {user.is_active ? (
                          <Button
                            type="button"
                            variant="danger"
                            disabled={busy}
                            onClick={() => setPendingDeactivation(user)}
                          >
                            {text.deactivate}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => handleSetActive(user, true)}
                          >
                            {text.activate}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManageRoles ? (
        <div className="sk-card" data-testid="role-management-card">
          <h2 id="role-management-title">{text.rolesTitle}</h2>
          <p>{text.rolesSubtitle}</p>

          <div className="sk-stack">
            <Button
              type="button"
              data-testid="open-create-role"
              onClick={() => setIsCreateRoleOpen(true)}
              disabled={busy}
            >
              {text.createRole}
            </Button>
          </div>

          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="role-management-table">
              <thead>
                <tr>
                  <th>{text.roleCode}</th>
                  <th>{text.roleName}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.code} data-testid={`role-row-${role.code}`}>
                    <td>
                      <strong>{role.code}</strong>
                    </td>
                    <td>{role.name}</td>
                    <td>
                      {role.code === 'SUPER_ADMIN' ? (
                        <span className="sk-field-help">{text.superAdminLocked}</span>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => openPermissionEditor(role)}
                        >
                          {text.editPermissions}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {isCreateUserOpen ? (
        <div
          className="sk-modal__backdrop"
          role="presentation"
          onClick={() => !busy && setIsCreateUserOpen(false)}
        >
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={text.createUser}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="sk-modal__title">{text.createUser}</h2>
            <form onSubmit={handleCreateUser}>
              <div className="sk-modal__body">
                <TextField
                  label={text.username}
                  data-testid="new-username"
                  value={formUsername}
                  onChange={(event) => setFormUsername(event.target.value)}
                  autoComplete="off"
                  required
                  disabled={busy}
                />
                <TextField
                  label={text.displayName}
                  data-testid="new-display-name"
                  value={formDisplayName}
                  onChange={(event) => setFormDisplayName(event.target.value)}
                  required
                  disabled={busy}
                />
                <TextField
                  label={text.password}
                  data-testid="new-password"
                  type="password"
                  value={formPassword}
                  onChange={(event) => setFormPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  disabled={busy}
                />
                <div className="sk-field">
                  <label className="sk-field__label" htmlFor="new-user-role">
                    {text.role}
                  </label>
                  <select
                    id="new-user-role"
                    data-testid="new-user-role"
                    className="sk-field__input"
                    value={formRoleCode}
                    onChange={(event) => setFormRoleCode(event.target.value)}
                    required
                    disabled={busy}
                  >
                    <option value="" disabled />
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sk-modal__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsCreateUserOpen(false)}
                  disabled={busy}
                >
                  {text.cancel}
                </Button>
                <Button type="submit" data-testid="submit-create-user" loading={busy}>
                  {text.save}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isAssignRoleOpen && targetUser ? (
        <div
          className="sk-modal__backdrop"
          role="presentation"
          onClick={() => !busy && setIsAssignRoleOpen(false)}
        >
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={text.assignRole}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="sk-modal__title">
              {text.assignRole} — {targetUser.username}
            </h2>
            <form onSubmit={handleAssignRole}>
              <div className="sk-modal__body">
                <div className="sk-field">
                  <label className="sk-field__label" htmlFor="assign-user-role">
                    {text.role}
                  </label>
                  <select
                    id="assign-user-role"
                    data-testid="assign-user-role"
                    className="sk-field__input"
                    value={assignRoleCode}
                    onChange={(event) => setAssignRoleCode(event.target.value)}
                    required
                    disabled={busy}
                  >
                    <option value="" disabled />
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sk-modal__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsAssignRoleOpen(false)}
                  disabled={busy}
                >
                  {text.cancel}
                </Button>
                <Button type="submit" data-testid="submit-assign-role" loading={busy}>
                  {text.save}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCreateRoleOpen ? (
        <div
          className="sk-modal__backdrop"
          role="presentation"
          onClick={() => !busy && setIsCreateRoleOpen(false)}
        >
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={text.createRole}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="sk-modal__title">{text.createRole}</h2>
            <form onSubmit={handleCreateRole}>
              <div className="sk-modal__body">
                <TextField
                  label={text.roleCode}
                  data-testid="new-role-code"
                  value={newRoleCode}
                  onChange={(event) => setNewRoleCode(event.target.value.toUpperCase())}
                  error={roleCodeInvalid ? text.roleCodeHelp : undefined}
                  autoComplete="off"
                  required
                  disabled={busy}
                />
                <small className="sk-field-help">{text.roleCodeHelp}</small>
                <TextField
                  label={text.roleName}
                  data-testid="new-role-name"
                  value={newRoleName}
                  onChange={(event) => setNewRoleName(event.target.value)}
                  required
                  disabled={busy}
                />
              </div>
              <div className="sk-modal__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsCreateRoleOpen(false)}
                  disabled={busy}
                >
                  {text.cancel}
                </Button>
                <Button
                  type="submit"
                  data-testid="submit-create-role"
                  loading={busy}
                  disabled={roleCodeInvalid}
                >
                  {text.save}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingRole && permissions ? (
        <div
          className="sk-modal__backdrop"
          role="presentation"
          onClick={() => !busy && setEditingRole(null)}
        >
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={text.editPermissions}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="sk-modal__title">
              {text.editPermissions} — {editingRole.name}
            </h2>
            <form onSubmit={handleSavePermissions}>
              <div className="sk-modal__body">
                {permissionsLoading ? (
                  <div data-testid="permission-grid-loading">
                    <Spinner />
                    <p>{text.permissionsLoading}</p>
                  </div>
                ) : permissionsLoadFailed ? (
                  <Banner tone="error" testId="permission-load-failed">
                    {text.permissionsLoadFailed}
                  </Banner>
                ) : (
                  <div style={PERMISSION_GRID} data-testid="permission-grid">
                    {permissions.map((permission) => (
                      <label
                        key={permission.code}
                        className="sk-checkbox-row"
                        title={permission.name}
                      >
                        <input
                          type="checkbox"
                          data-testid={`permission-${permission.code}`}
                          checked={draftPermissions.includes(permission.code)}
                          disabled={busy}
                          onChange={(event) =>
                            setDraftPermissions((previous) =>
                              event.target.checked
                                ? [...previous, permission.code]
                                : previous.filter((code) => code !== permission.code),
                            )
                          }
                        />
                        <span>{permission.code}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="sk-modal__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingRole(null)}
                  disabled={busy}
                >
                  {text.cancel}
                </Button>
                <Button
                  type="submit"
                  data-testid="submit-role-permissions"
                  loading={busy}
                  disabled={permissionsLoading || permissionsLoadFailed}
                >
                  {text.save}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pendingDeactivation ? (
        <ConfirmDialog
          title={text.deactivateConfirmTitle}
          body={
            <p>
              {text.deactivateConfirmBody} ({pendingDeactivation.username})
            </p>
          }
          confirmLabel={text.deactivate}
          cancelLabel={text.cancel}
          confirmVariant="danger"
          busy={busy}
          onConfirm={() => handleSetActive(pendingDeactivation, false)}
          onCancel={() => setPendingDeactivation(null)}
        />
      ) : null}
    </section>
  );
}
