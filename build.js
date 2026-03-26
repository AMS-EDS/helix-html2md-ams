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

/* eslint-disable no-console */

import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  existsSync, readFileSync, writeFileSync, readdirSync,
} from 'fs';
// eslint-disable-next-line import/no-extraneous-dependencies
import { config } from 'dotenv';

// eslint-disable-next-line no-underscore-dangle
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(__filename);

// Load environment variables from env file
config({ path: path.resolve(__dirname, '.env') });

/**
 * Validates the built bundle for common issues
 * @param {string} bundleContent - The bundle file content
 * @param {string[]} expectedVars - List of variable names that should be replaced
 * @param {object} validationConfig - Build validation configuration
 * @returns {string[]} Array of validation error messages (empty if valid)
 */
function validateBundle(bundleContent, expectedVars, validationConfig = {}) {
  const errors = [];

  // 1. Check for unreplaced process.env references for ALL variables
  console.log(`  Checking ${expectedVars.length} environment variables...`);
  expectedVars.forEach((varName) => {
    // Check for direct reference: process.env.VAR
    const unreplacedPattern = `process.env.${varName}`;
    if (bundleContent.includes(unreplacedPattern)) {
      errors.push(`Found unreplaced ${unreplacedPattern} in bundle`);
    }

    // Check for destructuring: const { VAR } = process.env
    const destructuringPattern = new RegExp(`\\{[^}]*\\b${varName}\\b[^}]*\\}\\s*=\\s*process\\.env`, 'g');
    if (destructuringPattern.test(bundleContent)) {
      errors.push(`Found destructuring of ${varName} from process.env (use direct access instead)`);
    }
  });

  // 2. Check for broken template literals with bucket names
  // Pattern: `helix-X-bus-${"value"}` (broken after replacement!)
  const brokenBucketPattern = /`helix-\w+-bus-\$\{["'][^"']+["']\}/g;
  const brokenMatches = bundleContent.match(brokenBucketPattern);
  if (brokenMatches) {
    errors.push(`Found broken bucket template literals: ${brokenMatches.join(', ')}`);
  }

  // 3. Check for template literals with unreplaced process.env
  const unreplacedInTemplate = /`[^`]*helix-\w+-bus[^`]*\$\{process\.env\./g;
  const unreplacedMatches = bundleContent.match(unreplacedInTemplate);
  if (unreplacedMatches) {
    errors.push(`Found unreplaced process.env in template literals: ${unreplacedMatches.join(', ')}`);
  }

  // 4. Verify correct bucket name patterns exist (string concatenation)
  const correctBucketPatterns = [
    /"helix-content-bus-" \+ \(/,
    /"helix-code-bus-" \+ \(/,
    /"helix-media-bus-" \+ \(/,
  ];

  const missingPatterns = correctBucketPatterns.filter((pattern) => !pattern.test(bundleContent));
  if (missingPatterns.length === correctBucketPatterns.length) {
    // Only warn if ALL patterns are missing (might be expected in some services)
    console.warn('  ⚠️  Warning: No bucket name concatenation patterns found in bundle');
  }

  // 5. Check for derived variables that should NOT be in process.env
  // These should be calculated from base variables, not accessed from environment
  const derivedVars = ['CONTENT_BUS_BUCKET', 'CODE_BUS_BUCKET', 'MEDIA_BUS_BUCKET', 'CONFIG_BUS_BUCKET'];
  derivedVars.forEach((varName) => {
    const directAccess = `process.env.${varName}`;
    if (bundleContent.includes(directAccess)) {
      console.warn(`  ⚠️  Warning: Found ${directAccess} - this should be calculated from HELIX_BUCKET_SUFFIX, not accessed from env`);
    }

    const destructuring = new RegExp(`\\{[^}]*\\b${varName}\\b[^}]*\\}\\s*=\\s*process\\.env`, 'g');
    if (destructuring.test(bundleContent)) {
      console.warn(`  ⚠️  Warning: Found destructuring of ${varName} from process.env - should calculate from HELIX_BUCKET_SUFFIX instead`);
    }
  });

  // 6. Check for common hardcoded domains that should be variablized
  const hardcodedDomains = [
    { pattern: /['"]https?:\/\/admin\.hlx\.live/g, should: 'DA_DOMAIN or HLX_PROD_SERVER_HOST_*' },
    { pattern: /['"]https?:\/\/da\.live/g, should: 'DA_DOMAIN' },
    { pattern: /['"]\.hlx\.page['"]/g, should: 'HLX_PROD_SERVER_HOST_PAGE' },
    { pattern: /['"]\.hlx\.live['"]/g, should: 'HLX_PROD_SERVER_HOST_LIVE' },
    { pattern: /['"]\.aem\.page['"]/g, should: 'HLX_PROD_SERVER_HOST_PAGE' },
    { pattern: /['"]\.aem\.live['"]/g, should: 'HLX_PROD_SERVER_HOST_LIVE' },
  ];

  hardcodedDomains.forEach(({ pattern, should }) => {
    const matches = bundleContent.match(pattern);
    // Filter out patterns that should be ignored
    const ignorePatterns = validationConfig.ignorePatterns?.hardcodedDomains || [];
    const filteredMatches = matches
      ? matches.filter((match) => !ignorePatterns
        .some((ignorePattern) => match.includes(ignorePattern)))
      : [];

    // Only warn if many occurrences (some might be in comments/docs)
    if (filteredMatches.length > 5) {
      console.warn(`  ⚠️  Warning: Found ${filteredMatches.length} potential hardcoded domains. Should use: ${should}`);
    }
  });

  return errors;
}

/**
 * Validates patch files to ensure they use string concatenation, not template literals
 * with process.env variables that will be replaced at build time.
 * @param {string} patchesDir - Path to patches directory
 * @param {string[]} buildReplacedVars - List of variables that build.js replaces
 * @returns {string[]} Array of error messages
 */
function validatePatches(patchesDir, buildReplacedVars) {
  const errors = [];

  if (!existsSync(patchesDir)) {
    return errors; // No patches directory, nothing to validate
  }

  const patchFiles = readdirSync(patchesDir).filter((f) => f.endsWith('.patch'));

  patchFiles.forEach((patchFile) => {
    const patchPath = path.join(patchesDir, patchFile);
    const patchContent = readFileSync(patchPath, 'utf8');

    // Check for template literals with build-replaced process.env variables
    buildReplacedVars.forEach((varName) => {
      // Pattern: `...${process.env.VAR}...`
      const templatePattern = new RegExp(`\`[^\`]*\\$\\{process\\.env\\.${varName}[^}]*\\}[^\`]*\``, 'g');
      const matches = patchContent.match(templatePattern);

      if (matches) {
        errors.push(`❌ ${patchFile}: Contains template literal with process.env.${varName}. Use string concatenation instead:\n   Example: 'prefix-' + (process.env.${varName} || 'default')`);
      }
    });
  });

  return errors;
}

// Read package.json to get version
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
const { version } = pkg;

// Read build validation config (if exists)
let buildValidationConfig = { ignorePatterns: {} };
const validationConfigPath = path.resolve(__dirname, '.build-validation.json');
if (existsSync(validationConfigPath)) {
  buildValidationConfig = JSON.parse(readFileSync(validationConfigPath, 'utf8'));
}

// Get replacement values from environment variables
// Note: We intentionally do NOT include secrets here (like CLIENT_ID/SECRET).
// Only infrastructure configuration that should be baked into the build.
// We only replace BASE variables, not derived ones (e.g., bucket names are calculated from suffix).
const helixBucketSuffix = process.env.HELIX_BUCKET_SUFFIX;
const hlxProdServerHostPage = process.env.HLX_PROD_SERVER_HOST_PAGE;
const hlxProdServerHostLive = process.env.HLX_PROD_SERVER_HOST_LIVE;
const hlxProdServerHostReview = process.env.HLX_PROD_SERVER_HOST_REVIEW;
const daDomain = process.env.DA_DOMAIN;
const daDomainContent = process.env.DA_DOMAIN_CONTENT;
const awsAccountId = process.env.AWS_ACCOUNT_ID;
const awsRegion = process.env.AWS_REGION;
const awsPartition = process.env.AWS_PARTITION;
const hlxAwsRoleName = process.env.HLX_AWS_ROLE_NAME;
// HELIX_BUCKET_NAMES should come from AWS Secrets Manager, not build-time replacement

try {
  const now = Date.now();

  // Validate patches BEFORE building to catch issues early
  console.log('Validating patch files...');
  const buildReplacedVars = [
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
  const patchErrors = validatePatches(path.resolve(__dirname, 'patches'), buildReplacedVars);
  if (patchErrors.length > 0) {
    console.error('❌ Patch validation failed:');
    patchErrors.forEach((error) => console.error(`  ${error}`));
    process.exitCode = 1;
    throw new Error('Patch validation failed. Fix patches and run again.');
  }
  console.log('✅ All patches valid');

  console.log('Building with hedy (esbuild/esm)...');

  // Pass through arguments to hedy (e.g. --deploy, --test)
  // We explicitly add the esbuild/esm flags that helix-admin requires
  const args = process.argv.slice(2).join(' ');
  const cmd = `npx hedy -v --bundler=esbuild --esm ${args}`;

  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });

  console.log('Post-processing to replace environment variables...');

  const bundlePath = path.resolve(__dirname, 'dist', 'helix3', `html2md@${version}-bundle.mjs`);

  if (existsSync(bundlePath)) {
    let bundleContent = readFileSync(bundlePath, 'utf8');

    // Define replacements. keys match process.env.KEY
    // We only replace BASE variables, not derived ones.
    // Derived variables (like bucket names) are calculated from base variables in source code.
    // We only replace if the variable is actually set in the environment.
    // This preserves the " || default" fallback in the code if the var is missing.
    const envReplacements = {
      HELIX_BUCKET_SUFFIX: helixBucketSuffix,
      HLX_PROD_SERVER_HOST_PAGE: hlxProdServerHostPage,
      HLX_PROD_SERVER_HOST_LIVE: hlxProdServerHostLive,
      HLX_PROD_SERVER_HOST_REVIEW: hlxProdServerHostReview,
      DA_DOMAIN: daDomain,
      DA_DOMAIN_CONTENT: daDomainContent,
      AWS_ACCOUNT_ID: awsAccountId,
      AWS_REGION: awsRegion,
      AWS_PARTITION: awsPartition,
      HLX_AWS_ROLE_NAME: hlxAwsRoleName,
      // HELIX_BUCKET_NAMES is NOT replaced at build time - it comes from AWS Secrets Manager
    };

    let replacedCount = 0;
    Object.entries(envReplacements).forEach(([key, value]) => {
      if (value) {
        // Replace template literal cases: ${process.env.VAR} -> value
        // Note: In ESM bundles, sometimes process.env.VAR matches exactly.
        const regexTemplate = new RegExp(`\\$\\{process\\.env\\.${key}\\}`, 'g');
        const regexLiteral = new RegExp(`process\\.env\\.${key}(?![A-Za-z0-9_])`, 'g');

        if (regexTemplate.test(bundleContent) || regexLiteral.test(bundleContent)) {
          console.log(`Replacing process.env.${key} with "${value}"`);

          bundleContent = bundleContent.replace(
            regexTemplate,
            value,
          );

          // For literal replacement, we stringify to ensure quotes are added if needed
          // e.g. process.env.REGION -> "us-east-1"
          bundleContent = bundleContent.replace(
            regexLiteral,
            JSON.stringify(value),
          );
          replacedCount += 1;
        }
      }
    });

    if (replacedCount > 0) {
      writeFileSync(bundlePath, bundleContent);
      const msg = `Successfully replaced ${replacedCount} environment variables in bundle.`;
      console.log(msg);
    } else {
      console.log('No environment variables matched for replacement.');
    }

    // Validate the bundle after replacement
    console.log('Validating bundle...');
    const validationErrors = validateBundle(
      bundleContent,
      Object.keys(envReplacements),
      buildValidationConfig,
    );
    if (validationErrors.length > 0) {
      console.error('❌ Build validation failed:');
      validationErrors.forEach((error) => console.error(`  - ${error}`));
      process.exitCode = 1;
      throw new Error('Build validation failed. See errors above.');
    }
    console.log('✅ Build validation passed');

    // Note: For ESM bundles, hedy uploads BOTH the zip AND the bundle file separately
    // The zip contains index.js (ESM adapter) which loads the bundle at runtime
    // We've already processed the bundle above, so hedy will deploy the processed version
  } else {
    // If we are just building (not deploying) or if the bundle naming changed,
    // warn but don't fail hard
    console.warn('Bundle file not found at:', bundlePath);
  }

  console.log('Build completed in', Date.now() - now, 'ms');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
