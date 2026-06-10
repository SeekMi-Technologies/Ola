const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, assertDistinct } = require('./db-fingerprint');

test('normalizes credentials, case, and query parameters', () => {
  assert.equal(
    fingerprint('mongodb+srv://user:pass@Example.NET/MyDb?retryWrites=true'),
    'example.net/mydb'
  );
});

for (const [uri, message] of [
  [undefined, /missing/],
  ['not-a-uri', /malformed/],
  ['https://example.com/db', /mongodb/],
  ['mongodb+srv://example.com', /database name/],
]) {
  test(`rejects invalid URI ${String(uri)}`, () => {
    assert.throws(() => fingerprint(uri), message);
  });
}

test('rejects matching environment fingerprints', () => {
  assert.throws(
    () =>
      assertDistinct([
        ['development', 'mongodb+srv://a:b@cluster.example/dev'],
        ['staging', 'mongodb+srv://c:d@cluster.example/dev?retryWrites=true'],
      ]),
    /staging database matches development/
  );
});

test('accepts three distinct environments', () => {
  assert.deepEqual(
    assertDistinct([
      ['development', 'mongodb+srv://a:b@dev.example/oladev'],
      ['staging', 'mongodb+srv://a:b@staging.example/olastaging'],
      ['production', 'mongodb+srv://a:b@prod.example/olaprod'],
    ]),
    {
      development: 'dev.example/oladev',
      staging: 'staging.example/olastaging',
      production: 'prod.example/olaprod',
    }
  );
});
