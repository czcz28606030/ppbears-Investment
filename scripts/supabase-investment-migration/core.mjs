export function remapValue(value, idMap, stringReplacements = new Map()) {
  if (typeof value === 'string') {
    let result = idMap.get(value) ?? value;
    for (const [source, target] of idMap) {
      result = result.replaceAll(source, target);
    }
    for (const [source, target] of stringReplacements) {
      result = result.replaceAll(source, target);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item) => remapValue(item, idMap, stringReplacements));
  }

  if (
    value === null
    || typeof value !== 'object'
    || value instanceof Date
    || Buffer.isBuffer(value)
  ) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      remapValue(item, idMap, stringReplacements),
    ]),
  );
}

export function chunkRows(rows, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError('Batch size must be a positive integer');
  }

  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export function getCommonColumns(sourceColumns, targetColumns, excluded = new Set()) {
  const targetSet = new Set(targetColumns);
  return sourceColumns.filter((column) => targetSet.has(column) && !excluded.has(column));
}

export function prepareValueForPostgres(value, dataType) {
  if (value === null || value === undefined) return value;
  if (dataType === 'json' || dataType === 'jsonb') return JSON.stringify(value);
  return value;
}

export function findNameConflicts(targetNames, migrationNames) {
  const migrationSet = new Set(migrationNames);
  return targetNames.filter((name) => migrationSet.has(name));
}

export function findTargetOnlyKeys(sourceRows, targetRows, key) {
  const sourceKeys = new Set(sourceRows.map((row) => row[key]));
  return targetRows.map((row) => row[key]).filter((value) => !sourceKeys.has(value));
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

export function buildInsertStatement(schema, table, columns, rows, options = {}) {
  if (columns.length === 0) {
    throw new Error('Insert requires at least one column');
  }
  if (rows.length === 0) {
    throw new Error('Insert requires at least one row');
  }

  const values = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const conflictColumns = options.conflictColumns ?? [];
  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
  let conflictClause = 'on conflict do nothing';
  if (conflictColumns.length > 0) {
    const conflictTarget = conflictColumns.map(quoteIdentifier).join(', ');
    const action = updateColumns.length > 0
      ? `do update set ${updateColumns.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(', ')}`
      : 'do nothing';
    conflictClause = `on conflict (${conflictTarget}) ${action}`;
  }

  return {
    text: `insert into ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) values ${tuples.join(', ')} ${conflictClause}`,
    values,
  };
}

export function assertSummary(actual, expected) {
  const mismatches = Object.entries(expected)
    .filter(([key, expectedValue]) => actual[key] !== expectedValue)
    .map(([key, expectedValue]) => (
      `${key}: expected ${expectedValue}, received ${actual[key]}`
    ));

  if (mismatches.length > 0) {
    throw new Error(`Migration summary mismatch: ${mismatches.join('; ')}`);
  }
}

export function redactSecrets(text, secrets) {
  return secrets
    .filter((secret) => typeof secret === 'string' && secret.length > 0)
    .reduce((result, secret) => result.split(secret).join('[REDACTED]'), String(text));
}

export function requireApplyConfirmation(mode, confirmation) {
  if (mode !== 'apply') {
    throw new Error('Migration requires mode apply');
  }
  if (confirmation !== 'YES') {
    throw new Error('Database writes require MIGRATION_APPLY_CONFIRMED=YES');
  }
}
