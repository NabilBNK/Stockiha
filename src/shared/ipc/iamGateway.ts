import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import type { UserSnapshot, PermissionSnapshot, RoleSnapshot } from './iamDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function listUsers(sessionToken: string): Promise<UserSnapshot[]> {
  return call<UserSnapshot[]>(COMMANDS.LIST_USERS, { sessionToken });
}

/**
 * `password` is the raw plaintext. Hashing is Rust's responsibility
 * (`application::auth::hash_password`, Argon2); the frontend must never hash,
 * store, or log it.
 */
export function createUser(
  sessionToken: string,
  username: string,
  password: string,
  displayName: string,
  roleCode: string,
): Promise<number> {
  return call<number>(COMMANDS.CREATE_USER, {
    sessionToken,
    username,
    password,
    displayName,
    roleCode,
  });
}

export function setUserActive(
  sessionToken: string,
  targetUserId: number,
  isActive: boolean,
): Promise<void> {
  return call<void>(COMMANDS.SET_USER_ACTIVE, {
    sessionToken,
    targetUserId,
    isActive,
  });
}

export function assignUserRole(
  sessionToken: string,
  targetUserId: number,
  roleCode: string,
): Promise<void> {
  return call<void>(COMMANDS.ASSIGN_USER_ROLE, {
    sessionToken,
    targetUserId,
    roleCode,
  });
}

export function createRole(
  sessionToken: string,
  roleCode: string,
  roleName: string,
): Promise<number> {
  return call<number>(COMMANDS.CREATE_ROLE, {
    sessionToken,
    roleCode,
    roleName,
  });
}

export function listPermissions(sessionToken: string): Promise<PermissionSnapshot[]> {
  return call<PermissionSnapshot[]>(COMMANDS.LIST_PERMISSIONS, { sessionToken });
}

export function listRoles(sessionToken: string): Promise<RoleSnapshot[]> {
  return call<RoleSnapshot[]>(COMMANDS.LIST_ROLES, { sessionToken });
}

export function setRolePermissions(
  sessionToken: string,
  roleCode: string,
  permissionCodes: string[],
): Promise<void> {
  return call<void>(COMMANDS.SET_ROLE_PERMISSIONS, {
    sessionToken,
    roleCode,
    permissionCodes,
  });
}
