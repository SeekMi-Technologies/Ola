const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCrmEnv } = require('./render-crm-env');

const required = [
  'DASHSCOPE_API_KEY=dashscope-key',
  'BACKEND_PUBLIC_BASE_URL=https://example.com',
];

test('replaces the provider while preserving comments and ordering', () => {
  const source = [
    '# production settings',
    ...required,
    'TRANSCRIPTION_PROVIDER=legacy',
    '',
  ].join('\n');

  assert.equal(
    renderCrmEnv(source),
    [
      '# production settings',
      ...required,
      'TRANSCRIPTION_PROVIDER=paraformer',
      '',
    ].join('\n')
  );
});

test('adds the provider when it is missing', () => {
  assert.equal(
    renderCrmEnv(`${required.join('\n')}\n`),
    `${required.join('\n')}\nTRANSCRIPTION_PROVIDER=paraformer\n`
  );
});

test('applies deployment-specific provider lock and public callback URL', () => {
  const source = `${required.join('\n')}\n`;
  assert.equal(
    renderCrmEnv(source, {
      transcriptionProviderLocked: 'true',
      backendPublicBaseUrl: 'https://staging.olatech.ai',
    }),
    [
      'DASHSCOPE_API_KEY=dashscope-key',
      'BACKEND_PUBLIC_BASE_URL=https://staging.olatech.ai',
      'TRANSCRIPTION_PROVIDER=paraformer',
      'TRANSCRIPTION_PROVIDER_LOCKED=true',
      '',
    ].join('\n')
  );
});

for (const key of ['DASHSCOPE_API_KEY', 'BACKEND_PUBLIC_BASE_URL']) {
  test(`rejects a missing ${key}`, () => {
    const source = required.filter((line) => !line.startsWith(`${key}=`)).join('\n');
    assert.throws(() => renderCrmEnv(source), new RegExp(`${key} is required`));
  });
}
