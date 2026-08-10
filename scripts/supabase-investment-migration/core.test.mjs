import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSummary,
  buildInsertStatement,
  chunkRows,
  findNameConflicts,
  findTargetOnlyKeys,
  getCommonColumns,
  prepareValueForPostgres,
  redactSecrets,
  remapValue,
  requireApplyConfirmation,
} from './core.mjs';

const SOURCE_SHARED_USER_ID = '5b5aaa97-ac1a-4597-a7d2-b1d0672a32a4';
const TARGET_SHARED_USER_ID = 'f591c5a8-2645-4b6f-afb9-c2ffb1f556dc';

test('remapValue replaces duplicate auth UUIDs in nested database values', () => {
  const originalDate = new Date('2026-08-10T00:00:00.000Z');
  const originalBuffer = Buffer.from('attachment');
  const input = {
    user_id: SOURCE_SHARED_USER_ID,
    metadata: {
      owner: SOURCE_SHARED_USER_ID,
      related: [SOURCE_SHARED_USER_ID, 'unchanged'],
    },
    created_at: originalDate,
    bytes: originalBuffer,
  };

  const result = remapValue(input, new Map([
    [SOURCE_SHARED_USER_ID, TARGET_SHARED_USER_ID],
  ]));

  assert.deepEqual(result, {
    user_id: TARGET_SHARED_USER_ID,
    metadata: {
      owner: TARGET_SHARED_USER_ID,
      related: [TARGET_SHARED_USER_ID, 'unchanged'],
    },
    created_at: originalDate,
    bytes: originalBuffer,
  });
  assert.notEqual(result, input);
  assert.equal(result.created_at, originalDate);
  assert.equal(result.bytes, originalBuffer);
});

test('remapValue updates embedded project refs and remapped Storage folder ids', () => {
  const result = remapValue(
    {
      storage_path: `${SOURCE_SHARED_USER_ID}/trade/file.png`,
      source_url: 'https://bkbxzdbthxwccdfcwsub.supabase.co/storage/v1/object/private/file',
    },
    new Map([[SOURCE_SHARED_USER_ID, TARGET_SHARED_USER_ID]]),
    new Map([
      ['bkbxzdbthxwccdfcwsub', 'ilboytxdlydyrrdnwlon'],
    ]),
  );

  assert.deepEqual(result, {
    storage_path: `${TARGET_SHARED_USER_ID}/trade/file.png`,
    source_url: 'https://ilboytxdlydyrrdnwlon.supabase.co/storage/v1/object/private/file',
  });
});

test('chunkRows returns stable batches and rejects invalid batch sizes', () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([], 50), []);
  assert.throws(() => chunkRows([1], 0), /positive integer/);
});

test('getCommonColumns preserves source order and excludes generated columns', () => {
  assert.deepEqual(
    getCommonColumns(
      ['id', 'email', 'encrypted_password', 'created_at', 'generated_token'],
      ['created_at', 'id', 'email', 'encrypted_password'],
      new Set(['generated_token', 'encrypted_password']),
    ),
    ['id', 'email', 'created_at'],
  );
});

test('findNameConflicts blocks schema apply when target already owns an Investment object', () => {
  assert.deepEqual(
    findNameConflicts(
      ['assets', 'users', 'growth_social_posts', 'trade-attachments'],
      ['users', 'holdings', 'trade-attachments'],
    ),
    ['users', 'trade-attachments'],
  );
});

test('findTargetOnlyKeys identifies schema seed rows absent from the live source', () => {
  assert.deepEqual(
    findTargetOnlyKeys(
      [{ setting_key: 'one' }, { setting_key: 'three' }],
      [{ setting_key: 'one' }, { setting_key: 'two' }, { setting_key: 'three' }],
      'setting_key',
    ),
    ['two'],
  );
});

test('buildInsertStatement produces parameterized conflict-safe inserts', () => {
  const statement = buildInsertStatement(
    'public',
    'users',
    ['id', 'email'],
    [
      { id: 'user-1', email: 'one@example.test' },
      { id: 'user-2', email: 'two@example.test' },
    ],
  );

  assert.equal(
    statement.text,
    'insert into "public"."users" ("id", "email") values ($1, $2), ($3, $4) on conflict do nothing',
  );
  assert.deepEqual(statement.values, [
    'user-1',
    'one@example.test',
    'user-2',
    'two@example.test',
  ]);
  assert.throws(
    () => buildInsertStatement('public', 'users', [], [{ id: 'user-1' }]),
    /at least one column/,
  );

  const upsert = buildInsertStatement(
    'public',
    'users',
    ['id', 'email'],
    [{ id: 'user-1', email: 'new@example.test' }],
    { conflictColumns: ['id'] },
  );
  assert.equal(
    upsert.text,
    'insert into "public"."users" ("id", "email") values ($1, $2) on conflict ("id") do update set "email" = excluded."email"',
  );
});

test('prepareValueForPostgres preserves JSON arrays and JSON string scalars', () => {
  assert.equal(prepareValueForPostgres(['one', 'two'], 'jsonb'), '["one","two"]');
  assert.equal(prepareValueForPostgres('already a JSON scalar', 'json'), '"already a JSON scalar"');
  assert.deepEqual(prepareValueForPostgres(['one', 'two'], 'ARRAY'), ['one', 'two']);
  assert.equal(prepareValueForPostgres(null, 'jsonb'), null);
});

test('assertSummary rejects a partial migration with an actionable count', () => {
  assert.doesNotThrow(() => assertSummary(
    { authUsers: 20, publicTables: 27, storageObjects: 66 },
    { authUsers: 20, publicTables: 27, storageObjects: 66 },
  ));

  assert.throws(
    () => assertSummary(
      { authUsers: 20, publicTables: 27, storageObjects: 65 },
      { authUsers: 20, publicTables: 27, storageObjects: 66 },
    ),
    /storageObjects: expected 66, received 65/,
  );
});

test('redactSecrets removes every credential before migration output is logged', () => {
  const output = redactSecrets(
    'postgres://admin:db-password@example.test service-key-value',
    ['db-password', 'service-key-value'],
  );

  assert.equal(output, 'postgres://admin:[REDACTED]@example.test [REDACTED]');
  assert.equal(output.includes('db-password'), false);
  assert.equal(output.includes('service-key-value'), false);
});

test('requireApplyConfirmation prevents accidental writes in inventory mode', () => {
  assert.throws(
    () => requireApplyConfirmation('inventory', 'YES'),
    /requires mode apply/,
  );
  assert.throws(
    () => requireApplyConfirmation('apply', ''),
    /MIGRATION_APPLY_CONFIRMED=YES/,
  );
  assert.doesNotThrow(() => requireApplyConfirmation('apply', 'YES'));
});
