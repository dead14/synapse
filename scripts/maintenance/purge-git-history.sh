#!/usr/bin/env bash
# Purge leaked/bulky blobs from the entire git history of this repository.
#
# WHAT THIS REMOVES FROM HISTORY (already untracked in the working tree):
#   - .tmp-chrome/          committed Chrome profile (Login Data, Cookies, ...)
#   - .codex/               committed live PostgreSQL data directory
#   - .agents/ .hallmark/ .zcode/  agent tooling state
#   - backend/node_modules/ 4,900+ vendored dependency files
#   - backend/db_exports/   67 MB alignment session CSV export
#   - backend/config76.json 10 MB config dump
#   - backend/data_samples/test_token.txt  committed signed JWT
#   - free-react-tailwind-admin-dashboard-main{,.zip}  vendored template
#   - x/ x.rar tmp/         scratch archives and data
#   - *.pyc                 compiled Python bytecode
#
# PREREQUISITES
#   1. ROTATE CREDENTIALS FIRST (see docs/deployment/security-remediation.md).
#      History rewriting does not un-leak anything that was already pushed.
#   2. pip install git-filter-repo   (or: pipx install git-filter-repo)
#   3. Every collaborator has pushed their work; you are the only writer.
#
# USAGE
#   Run from a FRESH MIRROR CLONE, never from your working checkout:
#     git clone --mirror https://github.com/dead14/synapse.git synapse-purge.git
#     bash scripts/maintenance/purge-git-history.sh synapse-purge.git
#   Review the result, then publish it:
#     cd synapse-purge.git && git push --force --mirror
#   Afterwards every clone must be re-cloned (old clones still hold the blobs),
#   and GitHub Support can be asked to run garbage collection to drop cached
#   views of the old objects.

set -Eeuo pipefail

MIRROR_DIR="${1:?Usage: purge-git-history.sh <path-to-mirror-clone>}"

command -v git-filter-repo >/dev/null 2>&1 \
  || { echo "git-filter-repo is not installed (pip install git-filter-repo)"; exit 1; }

[[ -d "$MIRROR_DIR" ]] || { echo "Mirror clone not found: $MIRROR_DIR"; exit 1; }

cd "$MIRROR_DIR"

git filter-repo \
  --invert-paths \
  --path .tmp-chrome \
  --path .codex \
  --path .agents \
  --path .hallmark \
  --path .zcode \
  --path tmp \
  --path x \
  --path x.rar \
  --path backend/node_modules \
  --path backend/db_exports \
  --path backend/config76.json \
  --path backend/data_samples/test_token.txt \
  --path backend/temp_controller.js \
  --path free-react-tailwind-admin-dashboard-main \
  --path free-react-tailwind-admin-dashboard-main.zip \
  --path-glob '*.pyc' \
  --path-glob '**/__pycache__/**'

git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo
echo "History rewritten. Size now:"
git count-objects -vH | grep size-pack
echo
echo "Next steps:"
echo "  1. Inspect: git log --stat | head, git ls-tree -r HEAD | wc -l"
echo "  2. Publish: git push --force --mirror"
echo "  3. Have every collaborator delete old clones and re-clone."
