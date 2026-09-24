#!/usr/bin/env bash
# Builds the first commit of the public repository from the COMMITTED state of this one
# (docs/plan-instance-demo-cloudflare.md, lot B3 — decision: fresh history, the private
# history stays in the archived repository):
#   1. `git archive HEAD` into TARGET (uncommitted changes are never exported);
#   2. removes the paths of scripts/publication/public-exclude.txt;
#   3. runs scripts/publication/check_public_tree.mjs on the result (docker node:20, git inside),
#      with the name denylist of PUBLIC_DENYLIST if given — any finding aborts;
#   4. git init + one commit « Initial public release ».
# Nothing is pushed: creating the GitHub repository and pushing is a separate, manual step.
#
# Usage: PUBLIC_DENYLIST=/opt/crisalid/work/druid-instances/publication/denylist.txt \
#          scripts/publication/export_public_repo.sh /opt/crisalid/work/druid-public
set -euo pipefail

SRC="$(git rev-parse --show-toplevel)"
TARGET="${1:?usage: export_public_repo.sh TARGET_DIR}"
[ -e "$TARGET" ] && { echo "Refusing to overwrite existing $TARGET" >&2; exit 1; }
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

git -C "$SRC" archive HEAD | tar -x -C "$TARGET"
while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"
  [ -z "$line" ] && continue
  rm -rf "${TARGET:?}/${line%/}"
done < "$SRC/scripts/publication/public-exclude.txt"

cd "$TARGET"
git init -q -b main
git add -A

DENY_ARGS=()
if [ -n "${PUBLIC_DENYLIST:-}" ]; then
  DENY_ARGS=(-v "$(cd "$(dirname "$PUBLIC_DENYLIST")" && pwd):/deny:ro" -e "PUBLIC_DENYLIST=/deny/$(basename "$PUBLIC_DENYLIST")")
else
  echo "Warning: PUBLIC_DENYLIST not set — names are not checked." >&2
fi
docker run --rm -v "$TARGET":/app -w /app "${DENY_ARGS[@]}" node:20 \
  sh -c 'git config --global --add safe.directory /app && node scripts/publication/check_public_tree.mjs'

SOURCE_REV="$(git -C "$SRC" rev-parse --short HEAD)"
# Author: GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL, else the git identity configured for the source repository.
AUTHOR_NAME="${GIT_AUTHOR_NAME:-$(git -C "$SRC" config user.name || true)}"
AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-$(git -C "$SRC" config user.email || true)}"
[ -n "$AUTHOR_NAME" ] && [ -n "$AUTHOR_EMAIL" ] || { echo "Set GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL" >&2; exit 1; }
git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
  commit -q -m "Initial public release

Druid (Directory for Researchers, Units & Identifiers), CeCILL v2.1.
Exported from the private development repository at ${SOURCE_REV}; its
history is not published.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
echo "Public repository ready in $TARGET ($(git ls-files | wc -l) files, commit $(git rev-parse --short HEAD))."
