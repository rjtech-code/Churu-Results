import type { Knex } from 'knex';
import { DEFAULT_SCREEN_LAYOUT, SCREEN_LAYOUT_KEY } from '../../services/screen-layout.js';

export async function up(knex: Knex): Promise<void> {
  // Settings can now hold JSON such as the screen layout (13 full PS names = ~460 characters).
  await knex.raw('ALTER TABLE app_settings MODIFY setting_value VARCHAR(4000) NOT NULL');
  await knex.raw(
    `INSERT INTO app_settings (setting_key, setting_value)
     SELECT ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key = ?)`,
    [SCREEN_LAYOUT_KEY, JSON.stringify(DEFAULT_SCREEN_LAYOUT), SCREEN_LAYOUT_KEY],
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DELETE FROM app_settings WHERE setting_key = ?', [SCREEN_LAYOUT_KEY]);
  await knex.raw('ALTER TABLE app_settings MODIFY setting_value VARCHAR(255) NOT NULL');
}
