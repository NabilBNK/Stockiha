-- R6-001: prevent two creation requests from claiming the same second-based
-- bundle identifier. Validation attempts may intentionally reference the same
-- existing bundle, so uniqueness applies only to CREATE_BACKUP rows.
SET ROLE stockiha_owner;

CREATE UNIQUE INDEX recovery_attempts_create_bundle_unique
    ON operations.recovery_attempts (bundle_identifier)
    WHERE operation_code = 'CREATE_BACKUP';

UPDATE operations.schema_state
SET migration_version = 20260803201500,
    updated_at = now()
WHERE singleton;

RESET ROLE;
