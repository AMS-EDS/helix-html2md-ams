/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// loading local vars from .env file
dotenv.config();

/// Define the variables
// export const { HELIX_BUCKET_NAMES } = process.env;
export const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || 'BAD_VAR_html2md_AWS_ACCOUNT_ID';
export const AWS_REGION = process.env.AWS_REGION || 'BAD_VAR_html2md_AWS_REGION';
export const HLX_PROD_SERVER_HOST_PAGE = process.env.HLX_PROD_SERVER_HOST_PAGE || 'BAD_VAR_html2md_HLX_PROD_SERVER_HOST_PAGE';
export const HLX_PROD_SERVER_HOST_LIVE = process.env.HLX_PROD_SERVER_HOST_LIVE || 'BAD_VAR_html2md_HLX_PROD_SERVER_HOST_LIVE';
export const HLX_PROD_SERVER_HOST_REVIEW = process.env.HLX_PROD_SERVER_HOST_REVIEW || 'BAD_VAR_html2md_HLX_PROD_SERVER_HOST_REVIEW';

export const HELIX_BUCKET_SUFFIX = process.env.HELIX_BUCKET_SUFFIX || 'BAD_VAR_html2md_HELIX_BUCKET_SUFFIX';
process.env.HELIX_BUCKET_SUFFIX = HELIX_BUCKET_SUFFIX;

// Calculate bucket names from suffix, then set them in process.env
// This makes them available to both test code (via exports) and app code (via process.env)
export const CONTENT_BUS_BUCKET = `helix-content-bus-${HELIX_BUCKET_SUFFIX}` || 'BAD_VAR_html2md_CONTENT_BUS_BUCKET';
process.env.CONTENT_BUS_BUCKET = CONTENT_BUS_BUCKET;

export const CODE_BUS_BUCKET = `helix-code-bus-${HELIX_BUCKET_SUFFIX}` || 'BAD_VAR_html2md_CODE_BUS_BUCKET';
process.env.CODE_BUS_BUCKET = CODE_BUS_BUCKET;

export const MEDIA_BUS_BUCKET = `helix-media-bus-${HELIX_BUCKET_SUFFIX}` || 'BAD_VAR_html2md_MEDIA_BUS_BUCKET';
process.env.MEDIA_BUS_BUCKET = MEDIA_BUS_BUCKET;

export const CONFIG_BUS_BUCKET = `helix-config-bus-${HELIX_BUCKET_SUFFIX}` || 'BAD_VAR_html2md_CONFIG_BUS_BUCKET';
process.env.CONFIG_BUS_BUCKET = CONFIG_BUS_BUCKET;

// eslint-disable-next-line no-console
console.log('Forcing HTTP/1.1 for @adobe/fetch');
process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';
process.env.HELIX_ONEDRIVE_LOCAL_AUTH_CACHE = 'true';
process.env.HELIX_ONEDRIVE_NO_SHARE_LINK_CACHE = 'true';
process.env.HELIX_ONEDRIVE_NO_TENANT_CACHE = 'true';

// ensure that aws profile defined in the environment doesn't affect the tests
delete process.env.AWS_PROFILE;

// eslint-disable-next-line no-underscore-dangle
global.__rootdir = resolve(fileURLToPath(import.meta.url), '..', '..');
// eslint-disable-next-line no-underscore-dangle
global.__testdir = resolve(fileURLToPath(import.meta.url), '..');

// provide verbose for test logger
// eslint-disable-next-line no-console
console.verbose = console.debug;

// bypass error with mocha-suppress-logs
// see https://github.com/AleG94/mocha-suppress-logs/issues/12
export const mochaHooks = {
  afterEach() {
    if (this._runnable?.ctx?.currentTest?.intellij_test_node) {
      process.stdout.write('');
    }
  },
};

global.fetch = () => {
  throw Error('unsupported use of global fetch.');
};
