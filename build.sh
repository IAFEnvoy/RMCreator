#!/bin/bash
echo "{\"commit\": \"${CF_PAGES_COMMIT_SHA}\"}" > commit.json
pnpm build
cp commit.json dist/commit.json
