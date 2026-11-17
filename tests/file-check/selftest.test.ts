import { describe, expect, it } from 'vitest';
import { checkFile } from '../../src/scripts/file-check/engine/index.js';
import { sampleBytes } from '../../src/scripts/file-check/sample';
import { SAMPLE_ANSWER, answerOf } from '../../src/scripts/file-check/selftest';
import main from '../../src/scripts/file-check/main.ts?raw';

// File Check tests itself on its built-in sample before it reads a file. These checks hold the
// answer it expects to what the check really finds, so the two cannot drift apart unnoticed.
describe('File Check: the test the tool runs on itself', () => {
  it('expects the answer the check gives for the built-in sample', async () => {
    const report = await checkFile(sampleBytes(), 'workbook');
    expect(answerOf(report)).toBe(SAMPLE_ANSWER);
  });

  it('gives the same answer every time', async () => {
    const first = answerOf(await checkFile(sampleBytes(), 'workbook'));
    const second = answerOf(await checkFile(sampleBytes(), 'workbook'));
    expect(second).toBe(first);
  });

  it('gives another answer when a finding is missing', async () => {
    const report = await checkFile(sampleBytes(), 'workbook');
    expect(report.findings.length).toBeGreaterThan(3);
    expect(answerOf({ ...report, findings: report.findings.slice(1) })).not.toBe(SAMPLE_ANSWER);
  });

  it('is run by the page before a file is read, and a failed test stops the page', () => {
    expect(main).toContain("if ((await selfTest) === 'failed')");
    expect(main).toContain('did not give the expected answer for its built-in sample');
  });
});
