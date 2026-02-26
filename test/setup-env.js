/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
// eslint-disable-next-line no-console
import { resolve } from 'path';
import { fileURLToPath } from 'url';
// // loading local vars from .env file
// dotenv.config();

// export const {
//     AWS_PROFILE,
//     AWS_REGION,
//     HELIX_BUCKET_SUFFIX
// } = process.env;

// export const MEDIA_BUS_BUCKET = process.env.MEDIA_BUS_BUCKET ||=
//   `helix-media-bus-${HELIX_BUCKET_SUFFIX}`;
// export const S3_MEDIA_BUCKET =
//   `https://${MEDIA_BUS_BUCKET}.s3.${AWS_REGION}.amazonaws.com`;

// eslint-disable-next-line no-console
console.log('Forcing HTTP/1.1 for @adobe/fetch');
process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';
process.env.HELIX_ONEDRIVE_LOCAL_AUTH_CACHE = 'true';
process.env.HELIX_ONEDRIVE_NO_SHARE_LINK_CACHE = 'true';
process.env.HELIX_ONEDRIVE_NO_TENANT_CACHE = 'true';
process.env.HELIX_MEDIA_HANDLER_DISABLE_R2 = 'true';

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
