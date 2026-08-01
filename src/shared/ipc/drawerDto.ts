export interface DrawerOperationPolicy {
  operation_code: string;
  movement_type: string;
  movement_direction: 'IN' | 'OUT';
  is_enabled: boolean;
  description: string;
  can_manage: boolean;
}

export interface UpdateDrawerOperationPolicyPayload {
  operation_code: string;
  is_enabled: boolean;
}
