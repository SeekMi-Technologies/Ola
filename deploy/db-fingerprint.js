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

function assertDistinct(entries) {
  const seen = new Map();
  for (const [name, uri] of entries) {
    const value = fingerprint(uri);
    if (seen.has(value)) {
      throw new Error(`${name} database matches ${seen.get(value)} (${value})`);
    }
    seen.set(value, name);
  }
  return Object.fromEntries([...seen].map(([value, name]) => [name, value]));
}

if (require.main === module) {
  try {
    const names = process.argv.slice(2);
    if (names.length < 2) throw new Error('provide at least two environment variable names');
    const result = assertDistinct(names.map((name) => [name, process.env[name]]));
    for (const name of names) console.log(`${name}=${result[name]}`);
  } catch (error) {
    console.error(`database isolation check failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { fingerprint, assertDistinct };
