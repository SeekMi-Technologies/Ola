#!/usr/bin/env node

const fs = require('fs');

const REQUIRED_KEYS = ['DASHSCOPE_API_KEY', 'BACKEND_PUBLIC_BASE_URL'];

function upsertSetting(lines, key, value) {
  const setting = `${key}=${value}`;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = setting;
    return;
  }
  while (lines.at(-1) === '') lines.pop();
  lines.push(setting);
}

function renderCrmEnv(source, overrides = {}) {
  const lines = source.split(/\r?\n/);
  upsertSetting(lines, 'TRANSCRIPTION_PROVIDER', 'paraformer');
  if (overrides.transcriptionProviderLocked !== undefined) {
    upsertSetting(
      lines,
      'TRANSCRIPTION_PROVIDER_LOCKED',
      String(overrides.transcriptionProviderLocked)
    );
  }
  if (overrides.backendPublicBaseUrl) {
    upsertSetting(lines, 'BACKEND_PUBLIC_BASE_URL', overrides.backendPublicBaseUrl);
  }

  const values = new Map(
    lines
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );

  for (const key of REQUIRED_KEYS) {
    if (!values.get(key)) {
      throw new Error(`${key} is required for Paraformer transcription`);
    }
  }

  return lines.join('\n').replace(/\n*$/, '\n');
}

function main(envPath = process.argv[2]) {
  if (!envPath) {
    throw new Error('Usage: render-crm-env.js <backend-env-path>');
  }

  const source = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(envPath, renderCrmEnv(source, {
    transcriptionProviderLocked: process.env.CRM_TRANSCRIPTION_PROVIDER_LOCKED,
    backendPublicBaseUrl: process.env.CRM_BACKEND_PUBLIC_BASE_URL,
  }));
}

if (require.main === module) {
  main();
}

module.exports = { renderCrmEnv };
