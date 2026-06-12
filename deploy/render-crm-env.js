#!/usr/bin/env node

const fs = require('fs');

const REQUIRED_KEYS = ['DASHSCOPE_API_KEY', 'BACKEND_PUBLIC_BASE_URL'];
const TRANSCRIPTION_SETTING = 'TRANSCRIPTION_PROVIDER=paraformer';

function renderCrmEnv(source) {
  const lines = source.split(/\r?\n/);
  let foundProvider = false;
  const rendered = lines.map((line) => {
    if (!line.startsWith('TRANSCRIPTION_PROVIDER=')) return line;
    foundProvider = true;
    return TRANSCRIPTION_SETTING;
  });

  if (!foundProvider) {
    while (rendered.at(-1) === '') rendered.pop();
    rendered.push(TRANSCRIPTION_SETTING);
  }

  const values = new Map(
    rendered
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

  return rendered.join('\n').replace(/\n*$/, '\n');
}

function main(envPath = process.argv[2]) {
  if (!envPath) {
    throw new Error('Usage: render-crm-env.js <backend-env-path>');
  }

  const source = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(envPath, renderCrmEnv(source));
}

if (require.main === module) {
  main();
}

module.exports = { renderCrmEnv };
