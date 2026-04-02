#!/bin/bash
echo "{\"commit\": \"${CF_PAGES_COMMIT_SHA}\"}" > commit.json
# Remove self
rm -f build.sh
