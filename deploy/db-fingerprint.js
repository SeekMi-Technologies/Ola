#!/usr/bin/env node

function fingerprint(uri) {
  if (!uri) throw new Error('database URI is missing');
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('database URI is malformed');
  }
  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new Error('database URI must use mongodb:// or mongodb+srv://');
  }
  const database = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (!parsed.hostname || !database) {
    throw new Error('database URI must include a host and database name');
  }
  return `${parsed.hostname.toLowerCase()}/${database.toLowerCase()}`;
}

function pairKey(left, right) {
  return [left, right].sort().join('\0');
}

function assertDistinct(entries, allowedEqualPairs = []) {
  const allowed = new Set(allowedEqualPairs.map(([left, right]) => pairKey(left, right)));
  const seen = new Map();
  for (const [name, uri] of entries) {
    const value = fingerprint(uri);
    if (seen.has(value)) {
      const other = seen.get(value);
      if (!allowed.has(pairKey(name, other))) {
        throw new Error(`${name} database matches ${other} (${value})`);
      }
    } else {
      seen.set(value, name);
    }
  }
  return Object.fromEntries(entries.map(([name, uri]) => [name, fingerprint(uri)]));
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const allowedEqualPairs = [];
    const names = [];
    for (const arg of args) {
      if (arg.startsWith('--allow-equal=')) {
        const pair = arg.slice('--allow-equal='.length).split(',');
        if (pair.length !== 2 || pair.some((name) => !name)) {
          throw new Error('--allow-equal requires two comma-separated environment variable names');
        }
        allowedEqualPairs.push(pair);
      } else {
        names.push(arg);
      }
    }
    if (names.length < 2) throw new Error('provide at least two environment variable names');
    const unknown = allowedEqualPairs.flat().filter((name) => !names.includes(name));
    if (unknown.length) {
      throw new Error(`allowed equality references unknown environment variable ${unknown[0]}`);
    }
    const result = assertDistinct(
      names.map((name) => [name, process.env[name]]),
      allowedEqualPairs
    );
    for (const name of names) console.log(`${name}=${result[name]}`);
  } catch (error) {
    console.error(`database isolation check failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { fingerprint, assertDistinct };
