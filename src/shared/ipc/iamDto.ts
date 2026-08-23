/**
 * WS-A — DTOs for User & Role Administration (IAM).
 *
 * Shapes mirror the `iam.*` SECURITY DEFINER function result rows exactly.
 * `iam.user_roles` is a junction table, so a user may hold more than one role;
 * `iam.list_users` aggregates them into parallel arrays ordered by role code.
 */

export interface UserSnapshot {
  user_id: number;
  username: string;
  display_name: string;
  is_active: boolean;
  role_codes: string[];
  role_names: string[];
}

export interface PermissionSnapshot {
  code: string;
  name: string;
}

export interface RoleSnapshot {
  code: string;
  name: string;
}
