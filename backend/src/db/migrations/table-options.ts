// Shared DDL fragments for migrations. Not a migration itself (see migrations/index.ts).
export const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

export const CREATED_AT = 'created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)';
export const UPDATED_AT =
  'updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)';

/** Every foreign key in this schema uses these rules. */
export const FK_RULES = 'ON DELETE RESTRICT ON UPDATE RESTRICT';
