# helix-html2md-ams — AWS Lambda

HTML to Markdown converter. Transforms HTML content into Markdown for ingestion into the EDS content pipeline.

## Rules

@/Users/schmidt/Documents/git/eds_tools/ams-eds-terraform/.cursor/rules/lambda-development-standards.md
@/Users/schmidt/Documents/git/eds_tools/ams-eds-terraform/.cursor/rules/development-standards-shared.md

## Stack

- Runtime: Node.js 20+ on AWS Lambda
- Deploy: `npm run deploy` via `hedy`

## Reference Implementation

Copy patterns from `helix-admin-ams` (branch: `main-ams`), not from docs.

## Branch Strategy

- `main` — upstream mirror. Do not commit here.
- `main-ams` — primary working branch
