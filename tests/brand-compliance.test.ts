import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Brand Compliance & Controlled Rebrand Gate', () => {
  test('Web Admin public HTML contains Chatto Bot and no public Chaty Bot references', () => {
    const htmlPath = path.join(rootDir, 'apps/web-admin/public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Asserts on new brand
    assert.match(html, /<title>Chatto Bot — AI Operations SaaS Platform/, 'Must have Chatto Bot title');
    assert.match(html, /Chatto Bot <span class="brand-badge">/, 'Must have Chatto Bot in header');
    assert.match(html, /น้อง <strong>Chatto<\/strong>/, 'Must have น้อง Chatto in greeting');
    assert.match(html, /Chatto Bot AI Operations Platform &copy; 2026/, 'Must have Chatto Bot in footer');

    // Forbidden legacy brand checks
    assert.doesNotMatch(html, /<title>Chaty Bot/i, 'Must not have Chaty Bot in title');
    assert.doesNotMatch(html, /น้อง <strong>Chaty<\/strong>/i, 'Must not have น้อง Chaty in greeting');
  });

  test('Agent Orchestrator responses consistently use น้อง Chatto persona', () => {
    const orchPath = path.join(rootDir, 'packages/agent-runtime/src/orchestrator.ts');
    const code = fs.readFileSync(orchPath, 'utf8');

    assert.match(code, /น้อง Chatto/, 'Must contain น้อง Chatto persona');
    assert.doesNotMatch(code, /น้อง Chaty/, 'Must not contain legacy น้อง Chaty');
  });

  test('Package metadata reflects Chatto Bot branding', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    assert.strictEqual(pkg.name, 'chatto-bot-ai-operations');
    assert.strictEqual(pkg.author, 'Chatto Bot Team');
    assert.ok(pkg.keywords.includes('chatto-bot'));
  });
});
