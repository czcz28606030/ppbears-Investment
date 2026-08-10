import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import {
  assertSummary,
  buildInsertStatement,
  chunkRows,
  findNameConflicts,
  findTargetOnlyKeys,
  getCommonColumns,
  prepareValueForPostgres,
  remapValue,
  requireApplyConfirmation,
} from './core.mjs';

const { Client } = pg;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE_REF = 'bkbxzdbthxwccdfcwsub';
const TARGET_REF = 'ilboytxdlydyrrdnwlon';
const SOURCE_SHARED_USER_ID = '5b5aaa97-ac1a-4597-a7d2-b1d0672a32a4';
const TARGET_SHARED_USER_ID = 'f591c5a8-2645-4b6f-afb9-c2ffb1f556dc';
const STORAGE_BUCKET = 'trade-attachments';

const ID_MAP = new Map([[SOURCE_SHARED_USER_ID, TARGET_SHARED_USER_ID]]);
const STRING_REPLACEMENTS = new Map([[SOURCE_REF, TARGET_REF]]);

const SOURCE_TABLES = [
  'active_etf_holdings',
  'active_etf_stock_flows',
  'ai_trading_signals',
  'backtest_cache',
  'dividend_payments',
  'feature_overrides',
  'holdings',
  'learning_profiles',
  'learning_wallet',
  'lesson_progress',
  'newsletter_daily_cache',
  'redemption_requests',
  'reward_rules',
  'reward_shop_items',
  'simons_daily_snapshots',
  'stock_daily_cache',
  'stock_price_history',
  'stock_profiles',
  'stock_quant_daily_snapshots',
  'system_settings',
  'trade_attachments',
  'trades',
  'user_market_daily_cache',
  'users',
  'wallet_transactions',
  'watchlist',
  'withdrawal_requests',
];

const SOURCE_FUNCTIONS = [
  'approve_redemption',
  'execute_buy_trade',
  'execute_sell_trade',
  'freeze_coins',
  'grant_learning_coins',
  'is_admin',
  'reject_redemption',
  'upsert_and_credit_dividend',
];

const SOURCE_EXPECTED = {
  authUsers: 20,
  publicTables: 27,
  publicFunctions: 8,
  storageObjects: 66,
  storageBytes: 3_659_758,
};

const TARGET_BASELINE = {
  authUsers: 1,
  publicTables: 38,
  publicFunctions: 15,
  storageObjects: 15_937,
  storageBytes: 31_082_120_450,
};

const TARGET_DESIGN_TABLE_BASELINE = {
  admin_notifications: 2,
  admin_preferences: 1,
  ai_style_presets: 5,
  ai_usage_log: 8,
  assets: 1532,
  catalog_changes: 0,
  catalog_content_versions: 0,
  catalog_image_slots: 36,
  catalog_import_jobs: 6,
  catalog_model_aliases: 0,
  catalog_platform_connection_events: 28,
  catalog_platform_connections: 2,
  catalog_source_facts: 0,
  catalog_source_snapshots: 0,
  catalog_sources: 2,
  catalog_template_versions: 0,
  custom_designs: 1093,
  design_templates: 2,
  designs: 1,
  growth_activity_events: 1312,
  growth_daily_insight_reports: 36,
  growth_media_assets: 1,
  growth_meta_ads_candidates: 142,
  growth_meta_ads_decisions: 0,
  growth_meta_ads_insight_snapshots: 0,
  growth_meta_ads_objects: 0,
  growth_product_plans: 0,
  growth_social_comment_replies: 0,
  growth_social_post_insights: 1211,
  growth_social_posts: 199,
  growth_video_projects: 15,
  option_groups: 75,
  option_items: 131,
  product_categories: 28,
  products: 359,
  store_settings: 2,
  tenant_users: 0,
  tenants: 0,
};

const SCHEMA_FILES = [
  'supabase-schema.sql',
  'supabase-trade-rpc.sql',
  'supabase-watchlist.sql',
  'supabase-learning-schema.sql',
  'supabase-rewards-schema.sql',
  'supabase-dividend-schema.sql',
  'supabase-backtest-schema.sql',
  'supabase-active-etf-schema.sql',
  'supabase/migrations/20260630050000_user_market_daily_cache.sql',
  'supabase/migrations/20260711010000_trade_attachments.sql',
  'supabase/migrations/20260711020000_trade_attachment_retention.sql',
];

function getMode() {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : '';
  if (!['inventory', 'apply', 'verify'].includes(mode)) {
    throw new Error('Use --mode inventory, apply, or verify');
  }
  return mode;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment setting: ${name}`);
  return value;
}

function getPgConfig(prefix) {
  const names = ['HOST', 'PORT', 'USER', 'PASSWORD', 'DATABASE'];
  const values = Object.fromEntries(names.map((name) => [
    name.toLowerCase(),
    process.env[`MIGRATION_${prefix}_${name}`],
  ]));
  const missing = names.filter((name) => !process.env[`MIGRATION_${prefix}_${name}`]);
  if (missing.length > 0) {
    throw new Error(`Missing ${prefix} database settings: ${missing.join(', ')}`);
  }
  return {
    host: values.host,
    port: Number(values.port),
    user: values.user,
    password: values.password,
    database: values.database,
    ssl: { rejectUnauthorized: false },
  };
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function countRowsByTable(client, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const result = await client.query(`select count(*)::bigint as count from public.${quoteIdentifier(tableName)}`);
    counts[tableName] = Number(result.rows[0].count);
  }
  return counts;
}

async function readInventory(client) {
  const summaryResult = await client.query(`
    select
      (select count(*)::bigint from auth.users) as auth_users,
      (select count(*)::bigint from storage.objects) as storage_objects,
      (select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects) as storage_bytes
  `);
  const tablesResult = await client.query(`
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `);
  const functionsResult = await client.query(`
    select distinct p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `);
  const bucketsResult = await client.query(`
    select id, name, public
    from storage.buckets
    order by name
  `);
  const tableNames = tablesResult.rows.map((row) => row.tablename);
  const row = summaryResult.rows[0];
  return {
    authUsers: Number(row.auth_users),
    publicTables: tableNames.length,
    publicFunctions: functionsResult.rows.length,
    storageObjects: Number(row.storage_objects),
    storageBytes: Number(row.storage_bytes),
    tables: await countRowsByTable(client, tableNames),
    functions: functionsResult.rows.map((item) => item.proname),
    buckets: bucketsResult.rows,
  };
}

function printableInventory(inventory) {
  return {
    authUsers: inventory.authUsers,
    publicTables: inventory.publicTables,
    publicFunctions: inventory.publicFunctions,
    storageObjects: inventory.storageObjects,
    storageBytes: inventory.storageBytes,
    tables: inventory.tables,
    functions: inventory.functions,
    buckets: inventory.buckets,
  };
}

function validateSourceInventory(inventory) {
  assertSummary(inventory, SOURCE_EXPECTED);
  const tablesMatch = SOURCE_TABLES.every((name) => Object.hasOwn(inventory.tables, name));
  const functionsMatch = SOURCE_FUNCTIONS.every((name) => inventory.functions.includes(name));
  const bucketMatch = inventory.buckets.some((bucket) => bucket.id === STORAGE_BUCKET && bucket.public === false);
  if (!tablesMatch || !functionsMatch || !bucketMatch) {
    throw new Error('Source schema no longer matches the approved Investment migration inventory');
  }
}

function validateTargetDesignBaseline(inventory) {
  for (const [tableName, baselineCount] of Object.entries(TARGET_DESIGN_TABLE_BASELINE)) {
    const actual = inventory.tables[tableName];
    if (actual === undefined || actual < baselineCount) {
      throw new Error(`Target design table ${tableName} fell below its pre-migration baseline`);
    }
  }
}

async function applySchema(targetClient, targetInventory) {
  const tableConflicts = findNameConflicts(Object.keys(targetInventory.tables), SOURCE_TABLES);
  const functionConflicts = findNameConflicts(targetInventory.functions, SOURCE_FUNCTIONS);
  const bucketConflicts = targetInventory.buckets
    .filter((bucket) => bucket.id === STORAGE_BUCKET)
    .map((bucket) => bucket.id);
  const conflictCount = tableConflicts.length + functionConflicts.length + bucketConflicts.length;
  const expectedCount = SOURCE_TABLES.length + SOURCE_FUNCTIONS.length + 1;

  if (conflictCount === expectedCount) {
    console.log('Investment schema already exists; schema apply skipped.');
    return;
  }
  if (conflictCount !== 0) {
    throw new Error(`Partial Investment schema conflict detected (${conflictCount}/${expectedCount}); refusing to overwrite target objects`);
  }

  await targetClient.query('begin');
  try {
    for (const relativePath of SCHEMA_FILES) {
      const sql = await fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
      await targetClient.query(sql);
    }
    await targetClient.query('commit');
    console.log('Investment schema created in target.');
  }
  catch (error) {
    await targetClient.query('rollback');
    throw error;
  }
}

async function readInsertableColumns(client, schema, table) {
  const result = await client.query(`
    select column_name, is_generated, is_identity, identity_generation
    from information_schema.columns
    where table_schema = $1 and table_name = $2
    order by ordinal_position
  `, [schema, table]);
  return result.rows
    .filter((row) => row.is_generated === 'NEVER' && !(row.is_identity === 'YES' && row.identity_generation === 'ALWAYS'))
    .map((row) => row.column_name);
}

async function readPrimaryKeyColumns(client, schema, table) {
  const result = await client.query(`
    select a.attname as column_name
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(i.indkey) with ordinality as key(attnum, position) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = key.attnum
    where n.nspname = $1 and c.relname = $2 and i.indisprimary
    order by key.position
  `, [schema, table]);
  return result.rows.map((row) => row.column_name);
}

async function readColumnTypes(client, schema, table) {
  const result = await client.query(`
    select column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = $1 and table_name = $2
  `, [schema, table]);
  return new Map(result.rows.map((row) => [
    row.column_name,
    row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type,
  ]));
}

async function copyTable({ sourceClient, targetClient, schema, table, rowFilter, conflictMode = 'upsert' }) {
  const [sourceColumns, targetColumns, primaryKeyColumns, targetColumnTypes] = await Promise.all([
    readInsertableColumns(sourceClient, schema, table),
    readInsertableColumns(targetClient, schema, table),
    readPrimaryKeyColumns(targetClient, schema, table),
    readColumnTypes(targetClient, schema, table),
  ]);
  const columns = getCommonColumns(sourceColumns, targetColumns);
  const sourceResult = await sourceClient.query(`select * from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`);
  const selectedRows = rowFilter ? sourceResult.rows.filter(rowFilter) : sourceResult.rows;
  const rows = selectedRows.map((row) => {
    const remapped = remapValue(row, ID_MAP, STRING_REPLACEMENTS);
    return Object.fromEntries(columns.map((column) => [
      column,
      prepareValueForPostgres(remapped[column], targetColumnTypes.get(column)),
    ]));
  });
  for (const batch of chunkRows(rows, 200)) {
    const statement = buildInsertStatement(schema, table, columns, batch, {
      conflictColumns: conflictMode === 'upsert' ? primaryKeyColumns : [],
    });
    await targetClient.query(statement);
  }
  return rows.length;
}

async function validateDuplicateAuthIdentity(sourceClient, targetClient) {
  const result = await Promise.all([
    sourceClient.query('select lower(email) as email from auth.users where id = $1', [SOURCE_SHARED_USER_ID]),
    targetClient.query('select lower(email) as email from auth.users where id = $1', [TARGET_SHARED_USER_ID]),
  ]);
  const sourceEmail = result[0].rows[0]?.email;
  const targetEmail = result[1].rows[0]?.email;
  if (!sourceEmail || !targetEmail || sourceEmail !== targetEmail) {
    throw new Error('The approved duplicate Auth identity mapping no longer matches source and target');
  }
}

async function resetSerialSequences(targetClient) {
  const result = await targetClient.query(`
    select table_name, column_name,
      pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) as sequence_name
    from information_schema.columns
    where table_schema = 'public' and table_name = any($1::text[])
  `, [SOURCE_TABLES]);
  for (const row of result.rows.filter((item) => item.sequence_name)) {
    const maximum = await targetClient.query(
      `select max(${quoteIdentifier(row.column_name)})::bigint as maximum from public.${quoteIdentifier(row.table_name)}`,
    );
    const value = maximum.rows[0].maximum;
    if (value !== null) {
      await targetClient.query('select setval($1::regclass, $2::bigint, true)', [row.sequence_name, value]);
    }
  }
}

async function removeSourceAbsentSchemaSeeds(sourceClient, targetClient) {
  const [sourceSettings, targetSettings] = await Promise.all([
    sourceClient.query('select setting_key from public.system_settings'),
    targetClient.query('select setting_key from public.system_settings'),
  ]);
  const extraKeys = findTargetOnlyKeys(sourceSettings.rows, targetSettings.rows, 'setting_key');
  if (extraKeys.length > 0) {
    await targetClient.query('delete from public.system_settings where setting_key = any($1::text[])', [extraKeys]);
  }
}

async function copyDatabase(sourceClient, targetClient) {
  await validateDuplicateAuthIdentity(sourceClient, targetClient);
  await targetClient.query('begin');
  try {
    await targetClient.query('set local session_replication_role = replica');
    const authUsers = await copyTable({
      sourceClient,
      targetClient,
      schema: 'auth',
      table: 'users',
      rowFilter: (row) => row.id !== SOURCE_SHARED_USER_ID,
    });
    const authIdentities = await copyTable({
      sourceClient,
      targetClient,
      schema: 'auth',
      table: 'identities',
      rowFilter: (row) => row.user_id !== SOURCE_SHARED_USER_ID,
      conflictMode: 'ignore',
    });
    const tableCounts = {};
    for (const table of SOURCE_TABLES) {
      tableCounts[table] = await copyTable({ sourceClient, targetClient, schema: 'public', table });
    }
    await removeSourceAbsentSchemaSeeds(sourceClient, targetClient);
    await resetSerialSequences(targetClient);
    await targetClient.query('commit');
    console.log(JSON.stringify({ databaseCopy: { authUsers, authIdentities, tables: tableCounts } }, null, 2));
  }
  catch (error) {
    await targetClient.query('rollback');
    throw error;
  }
}

async function readStorageObjects(client) {
  const result = await client.query(`
    select name, metadata
    from storage.objects
    where bucket_id = $1
    order by name
  `, [STORAGE_BUCKET]);
  return result.rows;
}

async function copyStorage(sourceClient, targetClient) {
  const [sourceObjects, targetObjects] = await Promise.all([
    readStorageObjects(sourceClient),
    readStorageObjects(targetClient),
  ]);
  const sourceSupabase = createClient(
    requireEnvironment('MIGRATION_SOURCE_URL'),
    requireEnvironment('MIGRATION_SOURCE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const targetSupabase = createClient(
    requireEnvironment('MIGRATION_TARGET_URL'),
    requireEnvironment('MIGRATION_TARGET_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const existingTargetNames = new Set(targetObjects.map((item) => item.name));
  let copied = 0;
  for (const object of sourceObjects) {
    const targetName = remapValue(object.name, ID_MAP, STRING_REPLACEMENTS);
    const { data, error: downloadError } = await sourceSupabase.storage.from(STORAGE_BUCKET).download(object.name);
    if (downloadError) throw new Error(`Storage download failed for an Investment attachment: ${downloadError.message}`);
    const contentType = object.metadata?.mimetype ?? object.metadata?.contentType ?? 'application/octet-stream';
    const { error: uploadError } = await targetSupabase.storage.from(STORAGE_BUCKET).upload(targetName, data, {
      contentType,
      upsert: true,
    });
    if (uploadError) throw new Error(`Storage upload failed for an Investment attachment: ${uploadError.message}`);
    if (!existingTargetNames.has(targetName)) copied += 1;
  }
  console.log(`Investment Storage synchronized (${sourceObjects.length} source objects, ${copied} newly created).`);
}

async function countForeignKeyOrphans(client) {
  const constraints = await client.query(`
    select
      con.conname,
      src.relname as source_table,
      tgt_ns.nspname as target_schema,
      tgt.relname as target_table,
      array_agg(src_attr.attname::text order by keys.position) as source_columns,
      array_agg(tgt_attr.attname::text order by keys.position) as target_columns
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_namespace src_ns on src_ns.oid = src.relnamespace
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_namespace tgt_ns on tgt_ns.oid = tgt.relnamespace
    join unnest(con.conkey, con.confkey) with ordinality as keys(source_attnum, target_attnum, position) on true
    join pg_attribute src_attr on src_attr.attrelid = src.oid and src_attr.attnum = keys.source_attnum
    join pg_attribute tgt_attr on tgt_attr.attrelid = tgt.oid and tgt_attr.attnum = keys.target_attnum
    where con.contype = 'f' and src_ns.nspname = 'public' and src.relname = any($1::text[])
    group by con.conname, src.relname, tgt_ns.nspname, tgt.relname
  `, [SOURCE_TABLES]);
  let total = 0;
  for (const constraint of constraints.rows) {
    const nonNull = constraint.source_columns.map((column) => `s.${quoteIdentifier(column)} is not null`).join(' and ');
    const matches = constraint.source_columns.map((column, index) => (
      `t.${quoteIdentifier(constraint.target_columns[index])} = s.${quoteIdentifier(column)}`
    )).join(' and ');
    const result = await client.query(`
      select count(*)::bigint as count
      from public.${quoteIdentifier(constraint.source_table)} s
      where ${nonNull}
        and not exists (
          select 1 from ${quoteIdentifier(constraint.target_schema)}.${quoteIdentifier(constraint.target_table)} t
          where ${matches}
        )
    `);
    total += Number(result.rows[0].count);
  }
  return total;
}

async function verifyTargetStorageDownload(targetObjects) {
  const object = targetObjects[0];
  if (!object) throw new Error('Target Investment Storage bucket is empty');
  const targetSupabase = createClient(
    requireEnvironment('MIGRATION_TARGET_URL'),
    requireEnvironment('MIGRATION_TARGET_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await targetSupabase.storage.from(STORAGE_BUCKET).download(object.name);
  if (error) throw new Error(`Target Investment Storage download verification failed: ${error.message}`);
  const expectedBytes = Number(object.metadata?.size ?? -1);
  if (data.size !== expectedBytes) {
    throw new Error(`Target Investment Storage download byte mismatch: expected ${expectedBytes}, received ${data.size}`);
  }
  return data.size;
}

async function verifyMigration(sourceClient, targetClient, sourceInventory) {
  const targetInventory = await readInventory(targetClient);
  validateTargetDesignBaseline(targetInventory);

  for (const table of SOURCE_TABLES) {
    if (targetInventory.tables[table] !== sourceInventory.tables[table]) {
      throw new Error(`Investment table ${table} row count mismatch: source ${sourceInventory.tables[table]}, target ${targetInventory.tables[table]}`);
    }
  }
  for (const functionName of SOURCE_FUNCTIONS) {
    if (!targetInventory.functions.includes(functionName)) {
      throw new Error(`Investment function ${functionName} is missing from target`);
    }
  }

  const authResult = await targetClient.query(`
    select
      count(*)::bigint as total,
      count(*) filter (where id = $1)::bigint as mapped_user
    from auth.users
  `, [TARGET_SHARED_USER_ID]);
  if (Number(authResult.rows[0].total) !== SOURCE_EXPECTED.authUsers || Number(authResult.rows[0].mapped_user) !== 1) {
    throw new Error('Target Auth user merge does not match the approved 20-user mapping');
  }

  const [sourceObjects, targetObjects] = await Promise.all([
    readStorageObjects(sourceClient),
    readStorageObjects(targetClient),
  ]);
  const targetByName = new Map(targetObjects.map((object) => [object.name, object]));
  let sourceBytes = 0;
  for (const sourceObject of sourceObjects) {
    const targetName = remapValue(sourceObject.name, ID_MAP, STRING_REPLACEMENTS);
    const targetObject = targetByName.get(targetName);
    const sourceSize = Number(sourceObject.metadata?.size ?? 0);
    const targetSize = Number(targetObject?.metadata?.size ?? -1);
    sourceBytes += sourceSize;
    if (!targetObject || sourceSize !== targetSize) {
      throw new Error('Investment Storage object set or byte size does not match source');
    }
  }
  if (targetObjects.length !== sourceObjects.length || sourceBytes !== SOURCE_EXPECTED.storageBytes) {
    throw new Error('Investment Storage bucket count or total bytes does not match source');
  }

  const storageApiDownloadBytes = await verifyTargetStorageDownload(targetObjects);
  const orphanForeignKeys = await countForeignKeyOrphans(targetClient);
  if (orphanForeignKeys !== 0) {
    throw new Error(`Target Investment data contains ${orphanForeignKeys} foreign-key orphan rows`);
  }

  const result = {
    authUsers: Number(authResult.rows[0].total),
    publicTables: SOURCE_TABLES.length,
    publicFunctions: SOURCE_FUNCTIONS.length,
    storageObjects: targetObjects.length,
    storageBytes: sourceBytes,
    storageApiDownloadBytes,
    orphanForeignKeys,
    designTablesPreserved: Object.keys(TARGET_DESIGN_TABLE_BASELINE).length,
  };
  assertSummary(result, {
    authUsers: SOURCE_EXPECTED.authUsers,
    publicTables: SOURCE_EXPECTED.publicTables,
    publicFunctions: SOURCE_EXPECTED.publicFunctions,
    storageObjects: SOURCE_EXPECTED.storageObjects,
    storageBytes: SOURCE_EXPECTED.storageBytes,
    orphanForeignKeys: 0,
    designTablesPreserved: Object.keys(TARGET_DESIGN_TABLE_BASELINE).length,
  });
  console.log(JSON.stringify({ verification: result }, null, 2));
}

async function main() {
  const mode = getMode();
  const sourceClient = new Client(getPgConfig('SOURCE'));
  const targetClient = new Client(getPgConfig('TARGET'));
  await Promise.all([sourceClient.connect(), targetClient.connect()]);
  await Promise.all([
    sourceClient.query('set role postgres'),
    targetClient.query('set role postgres'),
  ]);

  try {
    const [sourceInventory, targetInventory] = await Promise.all([
      readInventory(sourceClient),
      readInventory(targetClient),
    ]);
    validateSourceInventory(sourceInventory);
    validateTargetDesignBaseline(targetInventory);

    if (mode === 'inventory') {
      assertSummary(targetInventory, TARGET_BASELINE);
      console.log(JSON.stringify({
        mode,
        source: printableInventory(sourceInventory),
        target: printableInventory(targetInventory),
      }, null, 2));
      return;
    }

    if (mode === 'apply') {
      requireApplyConfirmation(mode, process.env.MIGRATION_APPLY_CONFIRMED);
      await applySchema(targetClient, targetInventory);
      await copyDatabase(sourceClient, targetClient);
      await copyStorage(sourceClient, targetClient);
    }

    await verifyMigration(sourceClient, targetClient, sourceInventory);
  }
  finally {
    await Promise.allSettled([sourceClient.end(), targetClient.end()]);
  }
}

await main();
