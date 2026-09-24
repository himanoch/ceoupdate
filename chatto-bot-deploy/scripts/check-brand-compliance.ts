import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Customer-facing files that MUST NOT contain legacy branding strings
const customerFacingFiles = [
  'apps/web-admin/public/index.html',
  'packages/agent-runtime/src/orchestrator.ts',
];

const forbiddenPatterns = [
  { pattern: /Chaty\s+Bot/i, label: 'Chaty Bot (public brand)' },
  { pattern: /น้อง\s*Chaty/i, label: 'น้อง Chaty (public persona)' },
];

console.log('🔍 [CI Brand Check] Auditing customer-facing surfaces for forbidden legacy brand names...');

let hasViolation = false;

for (const relativePath of customerFacingFiles) {
  const fullPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️ Warning: File not found: ${relativePath}`);
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(line)) {
        console.error(
          `❌ [Violation] Forbidden string "${rule.label}" found in ${relativePath}:${i + 1}\n   Line: ${line.trim()}`
        );
        hasViolation = true;
      }
    }
  }
}

if (hasViolation) {
  console.error('\n🚨 Brand Compliance Check FAILED! Forbidden legacy brand strings detected.');
  process.exit(1);
} else {
  console.log('✅ [CI Brand Check] All customer-facing surfaces comply with Chatto Bot branding standards!\n');
  process.exit(0);
}
