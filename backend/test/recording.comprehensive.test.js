/**
 * Structural contract tests for recordings/SKILL.md — Comprehensive multi-file analysis.
 *
 * Why test a Markdown file?
 * recordings/SKILL.md is loaded into the agent's system prompt on every turn
 * (always: true). Its sections are load-bearing behavioral contracts — a stray
 * merge or edit can silently delete a rule and regress agent behavior in production.
 * This test pins the critical anchors so CI catches it before deploy.
 *
 * Covers (issue #388):
 *   1. Section exists — "## Comprehensive multi-file analysis" is present
 *   2. Intent keywords that trigger the comprehensive path
 *   3. Path A (uploaded files) — file.search + batch get_transcript in one iteration
 *   4. Path B (WhatsApp voice history) — synthesize from context, zero file.* calls
 *   5. Required report sections — 共同主题 / 关键差异 / 综合结论
 *   6. Hard rules — no per-file progress, no duplicate calls, no invented content, no mixing
 *   7. Edge-case guards — single-file fallback, processing/failed skip
 */

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(
  __dirname,
  '../../ola/nanobot-workspace/skills/recordings/SKILL.md',
);

let skill;

beforeAll(() => {
  skill = fs.readFileSync(SKILL_PATH, 'utf8');
});

describe('recordings/SKILL.md — Comprehensive multi-file analysis section', () => {
  test('section heading exists', () => {
    expect(skill).toContain('## Comprehensive multi-file analysis');
  });

  describe('intent keywords', () => {
    test('comprehensive-mode trigger keywords are listed', () => {
      for (const kw of ['综合', '整体', '全部', '所有', '汇总', '横向对比']) {
        expect(skill).toContain(kw);
      }
    });
  });

  describe('Path A — uploaded files (web UI + WhatsApp attachment)', () => {
    test('Path A heading present', () => {
      expect(skill).toContain('Path A');
    });

    test('instructs file.search with status:done filter', () => {
      expect(skill).toContain('file.search({ status: "done" })');
    });

    test('mandates batch get_transcript in a single LLM iteration', () => {
      expect(skill).toContain('single LLM iteration');
    });

    test('instructs to hold output until all transcripts collected', () => {
      expect(skill).toContain('Do not output anything between the fetch step and the final report');
    });

    test('single-file fallback: count=1 does not trigger comprehensive path', () => {
      expect(skill).toContain('count = 1');
    });

    test('handles processing/failed files by skipping and noting', () => {
      expect(skill).toContain('processing');
      expect(skill).toContain('failed');
      expect(skill).toContain('note');
    });
  });

  describe('Path B — WhatsApp voice history (already in context)', () => {
    test('Path B heading present', () => {
      expect(skill).toContain('Path B');
    });

    test('references 语音消息转写 inline transcription prefix', () => {
      expect(skill).toContain('语音消息转写');
    });

    test('explicitly requires zero file.* tool calls on Path B', () => {
      expect(skill).toContain('zero `file.*` tool calls');
    });

    test('Path B single-recording guard present', () => {
      expect(skill).toContain('only one recording in context');
    });
  });

  describe('report structure', () => {
    test('requires 共同主题 section', () => {
      expect(skill).toContain('共同主题');
    });

    test('requires 关键差异 section', () => {
      expect(skill).toContain('关键差异');
    });

    test('requires 综合结论 section', () => {
      expect(skill).toContain('综合结论');
    });

    test('report ends with salesperson prompt', () => {
      expect(skill).toContain('需要我做什么？');
    });

    test('skipped-files note appended after three sections', () => {
      expect(skill).toContain('skipped files');
    });
  });

  describe('hard rules', () => {
    test('prohibits per-file progress commentary', () => {
      expect(skill).toContain('No per-file progress commentary');
    });

    test('prohibits duplicate file.get_transcript calls', () => {
      expect(skill).toContain('No duplicate tool calls');
    });

    test('prohibits invented content', () => {
      expect(skill).toContain('No invented content');
    });

    test('prohibits mixing Path A and Path B in one turn', () => {
      expect(skill).toContain('No mixing paths');
    });
  });

  describe('frontmatter', () => {
    test('always: true ensures skill is loaded on every turn', () => {
      expect(skill).toContain('always: true');
    });

    test('description mentions comprehensive analysis', () => {
      const frontmatterEnd = skill.indexOf('---', 3);
      const frontmatter = skill.slice(0, frontmatterEnd);
      expect(frontmatter).toContain('comprehensive');
    });
  });
});
