import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedResumeOrigin, safeFileName } from './resume-pdf.mjs';

test('résumé PDFs accept requests only from local pages', () => {
  assert.equal(allowedResumeOrigin(undefined), true);
  assert.equal(allowedResumeOrigin('null'), true);
  assert.equal(allowedResumeOrigin('http://localhost:8765'), true);
  assert.equal(allowedResumeOrigin('http://127.0.0.1:1420'), true);
  assert.equal(allowedResumeOrigin('https://example.com'), false);
  assert.equal(allowedResumeOrigin('http://localhost.example.com'), false);
});

test('résumé file names stay inside the résumé folder', () => {
  assert.equal(safeFileName('Scarlett_Lee_NYU_Stern_PM_Resume.pdf'), 'Scarlett_Lee_NYU_Stern_PM_Resume.pdf');
  assert.equal(safeFileName('..\\..\\Windows\\evil'), 'Windows_evil.pdf');
  assert.equal(safeFileName(''), 'Resume.pdf');
});
