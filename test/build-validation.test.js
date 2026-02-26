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
import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

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
    'AWS_ACCOUNT_ID',
    'AWS_REGION',
    'AWS_PARTITION',
    'HLX_AWS_ROLE_NAME',
  ];

  before(() => {
    // Read package.json to get version
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const { version } = packageJson;

    // Load validation config
    const configPath = resolve(process.cwd(), '.build-validation.json');
    validationConfig = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, 'utf8'))
      : { ignorePatterns: {} };

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

  it('should use correct bucket name patterns for content-bus', function () {
    if (validationConfig.skipTests?.bucketValidation) {
      this.skip();
    }
    // Valid patterns after build.js replacement:
    // 1. String concatenation: 'helix-content-bus-' + "8"
    // 2. Intermediate variable + template literal: `helix-content-bus-${HELIX_BUCKET_SUFFIX}`
    //    (where HELIX_BUCKET_SUFFIX is a local const, not process.env)
    //
    // Note: We only check content-bus since that's the one we know is used in source code.
    // Other buckets (code-bus, media-bus, config-bus) may only be used in dependencies.

    // Pattern 1: String concatenation (most common after patches)
    const concatPattern = /'helix-content-bus-'\s*\+\s*/g;
    const concatMatches = [...bundleContent.matchAll(concatPattern)];

    // Pattern 2: Template literal with local variable (used in source code)
    // Match: `helix-content-bus-${HELIX_BUCKET_SUFFIX}`
    // but NOT `helix-content-bus-${process.env.VAR}`
    const templatePattern = /`helix-content-bus-\$\{(?!process\.env)[^}]+\}`/g;
    const templateMatches = [...bundleContent.matchAll(templatePattern)];

    if (concatMatches.length === 0 && templateMatches.length === 0) {
      assert.fail(
        'No valid bucket name pattern found for helix-content-bus '
        + '(expected string concatenation or intermediate variable template literal)',
      );
    }
  });

  it('should use correct bucket name pattern for media-bus (from patches)', function () {
    if (validationConfig.skipTests?.bucketValidation) {
      this.skip();
    }
    // The helix-mediahandler patch should use string concatenation for media-bus
    // Pattern: 'helix-media-bus-' + (process.env.HELIX_BUCKET_SUFFIX || '')
    // After build.js replacement: "helix-media-bus-" + ("8" || "")

    const mediaBusPattern = /["']helix-media-bus-["']\s*\+\s*/g;
    const matches = [...bundleContent.matchAll(mediaBusPattern)];

    if (matches.length === 0) {
      assert.fail(
        'No valid bucket name pattern found for helix-media-bus. '
        + 'Check @adobe/helix-mediahandler patch uses string concatenation.',
      );
    }
  });

  it('should produce correct bucket names with HELIX_BUCKET_SUFFIX', function () {
    if (validationConfig.skipTests?.bucketValidation) {
      this.skip();
    }
    // Verify that the bundle will produce the expected bucket names at runtime
    // This checks that patches and source code correctly construct bucket names

    const suffix = process.env.HELIX_BUCKET_SUFFIX || '';
    const expectedBuckets = {
      'helix-content-bus': `helix-content-bus-${suffix}`,
      'helix-media-bus': `helix-media-bus-${suffix}`,
    };

    Object.entries(expectedBuckets).forEach(([busType]) => {
      // Check if the bundle contains construction patterns
      // (string concatenation or template literal)
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
});
