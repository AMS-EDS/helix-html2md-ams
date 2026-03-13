/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import assert from 'assert';

/**
 * Post-Build Bundle Validation Tests
 *
 * PURPOSE:
 * This test file provides standalone verification of the built bundle.
 * It is REDUNDANT with the validation built into build.js, but serves as:
 * 1. A standalone tool to verify an existing bundle without rebuilding
 * 2. Documentation of validation rules in test format
 * 3. A way to run validation via mocha test framework if preferred
 *
 * USAGE:
 * - `npm run test:build` - Builds and then runs this test
 * - Note: build.js already validates automatically, so this is optional
 *
 * WHY NEEDED:
 * Unit tests validate source code, but build.js performs string replacements
 * that can break code (e.g., template literals). This validates the FINAL
 * bundle that gets deployed.
 */

describe('Build Validation', () => {
  let bundleContent;
  let bundlePath;
  let validationConfig;

  // Variables that build.js should replace (from build.js envReplacements)
  const BUILD_REPLACED_VARS = [
    'HELIX_BUCKET_SUFFIX',
    'HLX_PROD_SERVER_HOST_PAGE',
    'HLX_PROD_SERVER_HOST_LIVE',
    'HLX_PROD_SERVER_HOST_REVIEW',
    'DA_DOMAIN',
    'DA_DOMAIN_CONTENT',
    'AWS_ACCOUNT_ID',
    'AWS_REGION',
    'AWS_PARTITION',
    'HLX_AWS_ROLE_NAME',
    'HELIX_BUCKET_NAMES',
  ];

  before(() => {
    // Load validation config
    const configPath = resolve(process.cwd(), '.build-validation.json');
    validationConfig = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, 'utf8'))
      : { ignorePatterns: {}, skipTests: {} };

    // Read package.json to get version
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const { version } = packageJson;

    // Construct bundle path
    bundlePath = resolve(process.cwd(), `dist/helix3/html2md@${version}-bundle.mjs`);

    try {
      bundleContent = readFileSync(bundlePath, 'utf8');
    } catch (err) {
      throw new Error(`Bundle not found at ${bundlePath}. Run 'npm run build' first.`);
    }
  });

  it('should not contain unreplaced process.env references for build-replaced variables', () => {
    // Only check for variables that build.js should have replaced
    const processEnvPattern = /process\.env\.([A-Z_]+)/g;
    const matches = [...bundleContent.matchAll(processEnvPattern)];
    const unreplacedBuildVars = matches
      .map((m) => m[1])
      .filter((varName) => BUILD_REPLACED_VARS.includes(varName));

    if (unreplacedBuildVars.length > 0) {
      const vars = [...new Set(unreplacedBuildVars)];
      assert.fail(`Found unreplaced build-time variables: ${vars.join(', ')}`);
    }
  });

  it('should not contain destructured process.env assignments for build-replaced variables', () => {
    // Check for destructuring from process.env for our build-replaced variables
    const destructuringPattern = /const\s*\{\s*([A-Z_,\s]+)\s*\}\s*=\s*process\.env/g;
    const matches = [...bundleContent.matchAll(destructuringPattern)];
    const problematicMatches = [];

    matches.forEach((match) => {
      const destructuredVars = match[1].split(',').map((v) => v.trim());
      const buildReplacedVars = destructuredVars.filter((v) => BUILD_REPLACED_VARS.includes(v));
      if (buildReplacedVars.length > 0) {
        problematicMatches.push({ full: match[0], vars: buildReplacedVars });
      }
    });

    if (problematicMatches.length > 0) {
      const examples = problematicMatches.slice(0, 3).map((m) => `${m.full} (${m.vars.join(', ')})`);
      assert.fail(`Found destructured process.env assignments for build-replaced variables (build.js cannot replace these):\n${examples.join('\n')}`);
    }
  });

  it('should not contain broken template literals', () => {
    // After build.js replacement, template literals like `prefix-${process.env.VAR}`
    // become `prefix-${"value"}` which is invalid
    const brokenTemplatePattern = /`[^`]*\$\{["'][^"']+["']\}[^`]*`/g;
    const matches = [...bundleContent.matchAll(brokenTemplatePattern)];

    // Filter out patterns that should be ignored
    const ignorePatterns = validationConfig.ignorePatterns?.brokenTemplateLiterals || [];
    const filteredMatches = matches.filter((match) => {
      const literal = match[0];
      return !ignorePatterns.some((pattern) => literal.includes(pattern));
    });

    if (filteredMatches.length > 0) {
      const examples = filteredMatches.slice(0, 3).map((m) => m[0]);
      assert.fail(`Found broken template literals (use string concatenation or intermediate variable):\n${examples.join('\n')}`);
    }
  });

  it('should not contain broken template literals with bucket names', () => {
    // After build.js replacement, template literals like `helix-X-bus-${process.env.VAR}`
    // become `helix-X-bus-${"value"}` which is invalid
    const brokenTemplatePattern = /helix-[a-z]+-bus-\$\{["'][^"']+["']\}/g;
    const matches = [...bundleContent.matchAll(brokenTemplatePattern)];

    if (matches.length > 0) {
      const examples = matches.slice(0, 3).map((m) => m[0]);
      assert.fail(`Found broken bucket template literals (use string concatenation or intermediate variable):\n${examples.join('\n')}`);
    }
  });

  it('should not contain template literals with process.env for build-replaced variables', () => {
    // Template literals with build-replaced process.env vars break after replacement
    // e.g., `some-${process.env.VAR}` becomes `some-${"value"}` (invalid)
    const templateLiteralPattern = /`[^`]*\$\{process\.env\.([A-Z_]+)\}[^`]*`/g;
    const matches = [...bundleContent.matchAll(templateLiteralPattern)];
    const problematicMatches = matches.filter((m) => BUILD_REPLACED_VARS.includes(m[1]));

    if (problematicMatches.length > 0) {
      const examples = problematicMatches.slice(0, 3).map((m) => m[0]);
      assert.fail(`Found template literals with build-replaced process.env variables (use intermediate variable or string concatenation):\n${examples.join('\n')}`);
    }
  });

  it('should use correct bucket name patterns for all helix buckets', function checkBucketPatterns() {
    if (validationConfig.skipTests?.bucketValidation) {
      this.skip();
    }
    // Valid patterns after build.js replacement:
    // 1. String concatenation: 'helix-X-bus-' + "8"
    // 2. Intermediate variable + template literal: `helix-X-bus-${HELIX_BUCKET_SUFFIX}`
    //    (where HELIX_BUCKET_SUFFIX is a local const, not process.env)

    const buckets = ['content', 'code', 'media', 'config'];
    const missingBuckets = [];
    const unusedBuckets = [];

    buckets.forEach((bucketType) => {
      // First check if this bucket is referenced at all in the bundle
      const hasReference = bundleContent.includes(`helix-${bucketType}-bus`);

      if (!hasReference) {
        unusedBuckets.push(bucketType);
        return; // Skip validation for unused buckets
      }

      // Pattern 1: String concatenation (most common after patches)
      const concatPattern = new RegExp(`['"]helix-${bucketType}-bus-['"]\\s*\\+\\s*`, 'g');
      const concatMatches = [...bundleContent.matchAll(concatPattern)];

      // Pattern 2: Template literal with local variable
      const templatePattern = new RegExp(`\`helix-${bucketType}-bus-\\$\\{(?!process\\.env)[^}]+\\}\``, 'g');
      const templateMatches = [...bundleContent.matchAll(templatePattern)];

      if (concatMatches.length === 0 && templateMatches.length === 0) {
        missingBuckets.push(bucketType);
      }
    });

    if (missingBuckets.length > 0) {
      assert.fail(
        `No valid bucket name pattern found for: ${missingBuckets.map((b) => `helix-${b}-bus`).join(', ')}\n`
        + 'Expected string concatenation or intermediate variable template literal.\n'
        + 'Check that patches are applied correctly.',
      );
    }

    // Log unused buckets for informational purposes (not a failure)
    if (unusedBuckets.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`ℹ️  Buckets not used by this function: ${unusedBuckets.map((b) => `helix-${b}-bus`).join(', ')}`);
    }
  });

  it('should produce correct bucket names with HELIX_BUCKET_SUFFIX', function checkBucketConstruction() {
    if (validationConfig.skipTests?.bucketValidation) {
      this.skip();
    }
    // Verify that the bundle will produce the expected bucket names at runtime
    // Only checks buckets that are actually used by this function

    const suffix = process.env.HELIX_BUCKET_SUFFIX || '';
    const allBuckets = {
      'helix-content-bus': `helix-content-bus-${suffix}`,
      'helix-code-bus': `helix-code-bus-${suffix}`,
      'helix-media-bus': `helix-media-bus-${suffix}`,
      'helix-config-bus': `helix-config-bus-${suffix}`,
    };

    // Only check buckets that are referenced in the bundle
    const bucketsToCheck = Object.keys(allBuckets)
      .filter((busType) => bundleContent.includes(busType));

    bucketsToCheck.forEach((busType) => {
      // Check if the bundle contains construction patterns
      // Pattern 1: "helix-X-bus-" + ("8" || "")
      const concatPattern = new RegExp(`["']${busType}-["']\\s*\\+`, 'g');
      // Pattern 2: `helix-X-bus-${HELIX_BUCKET_SUFFIX}`
      const templatePattern = new RegExp(`\`${busType}-\\$\\{[^}]+\\}\``, 'g');

      const hasConstruction = concatPattern.test(bundleContent)
        || templatePattern.test(bundleContent);

      if (!hasConstruction) {
        assert.fail(
          `Bundle does not appear to construct ${busType} correctly. `
          + 'Expected string concatenation or template literal pattern.',
        );
      }
    });
  });

  it('should warn if derived variables are accessed from process.env', () => {
    // Derived variables (CONTENT_BUS_BUCKET, etc.) should be calculated from
    // HELIX_BUCKET_SUFFIX, not accessed from process.env
    const derivedVars = [
      'CONTENT_BUS_BUCKET',
      'CODE_BUS_BUCKET',
      'MEDIA_BUS_BUCKET',
      'CONFIG_BUS_BUCKET',
    ];
    const warnings = [];

    derivedVars.forEach((varName) => {
      const pattern = new RegExp(`process\\.env\\.${varName}`, 'g');
      if (pattern.test(bundleContent)) {
        warnings.push(
          `Found process.env.${varName} - should calculate from HELIX_BUCKET_SUFFIX instead`,
        );
      }
    });

    if (warnings.length > 0) {
      // This is a warning, not a hard failure, but log it
      // eslint-disable-next-line no-console
      console.warn('⚠️  Build validation warnings:');
      // eslint-disable-next-line no-console
      warnings.forEach((w) => console.warn(`  - ${w}`));
    }
  });

  it('should warn about hardcoded domains', () => {
    const hardcodedDomains = [
      'hlx.page',
      'hlx.live',
      'da.live',
      'aem.page',
      'aem.live',
    ];

    const warnings = [];
    hardcodedDomains.forEach((domain) => {
      // Look for the domain as a string literal (not in comments)
      const escapedDomain = domain.replace('.', '\\.');
      const pattern = new RegExp(`['"\`]([^'"\`]*${escapedDomain}[^'"\`]*)['"\`]`, 'g');
      const matches = [...bundleContent.matchAll(pattern)];

      if (matches.length > 0) {
        warnings.push(`Found hardcoded domain "${domain}" (${matches.length} occurrences)`);
      }
    });

    if (warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('⚠️  Hardcoded domain warnings (verify these are intentional):');
      // eslint-disable-next-line no-console
      warnings.forEach((w) => console.warn(`  - ${w}`));
    }
  });

  it('should not have hardcoded us-east-1 region in Adobe packages', () => {
    // Check for hardcoded region: 'us-east-1' which breaks GovCloud and R2
    // Adobe packages should use process.env.AWS_REGION or 'auto' for R2
    const pattern = /region:\s*['"]us-east-1['"]/g;
    const matches = [...bundleContent.matchAll(pattern)];

    if (matches.length > 0) {
      const errors = [];
      matches.forEach((match) => {
        const { index } = match;
        const context = bundleContent.substring(Math.max(0, index - 100), index + 100);

        // Check if this is in an @adobe package context
        if (context.includes('@adobe')) {
          errors.push('Found hardcoded region: \'us-east-1\' (likely in @adobe package)');
        }
      });

      if (errors.length > 0) {
        assert.fail(
          'Bundle contains hardcoded \'us-east-1\' region in Adobe packages.\n'
          + 'This breaks GovCloud (needs process.env.AWS_REGION) and R2 (needs \'auto\').\n'
          + 'Fix by creating patches for affected packages:\n'
          + '  - For S3: change to process.env.AWS_REGION\n'
          + '  - For R2: change to \'auto\'\n'
          + `Errors found:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
        );
      }
    }
  });
});
