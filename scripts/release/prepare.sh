#!/usr/bin/env bash
# Step 1 of a release (CONTRIBUTING.md « Releases »): on an up-to-date main, bumps the version of
# package.json / package-lock.json, turns the « Non publié » section of CHANGELOG.md into the section of the
# version, commits on a branch prep/vX.Y.Z and opens the pull request to main (gh, when available).
# Needs only git, bash and sed (no Node).
#   scripts/release/prepare.sh 1.0.0
set -euo pipefail

die() { echo "prepare: $*" >&2; exit 1; }

VERSION=${1:-}
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: prepare.sh X.Y.Z"
TAG="v$VERSION"
cd "$(git rev-parse --show-toplevel)"

git diff --quiet HEAD || die "uncommitted changes"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run it from main"
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not up to date with origin/main (git pull)"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists"

CURRENT=$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' package.json | head -1)
[ -n "$CURRENT" ] || die "version not found in package.json"
[ "$CURRENT" != "$VERSION" ] || die "package.json is already at $VERSION"
[ "$(printf '%s\n%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)" = "$VERSION" ] || die "$VERSION is lower than $CURRENT"

# The unreleased section must say something: it becomes the release note.
NOTES=$(awk '/^## \[Non publié\]/{on=1; next} on && /^## \[/{exit} on && /^- /{n++} END{print n+0}' CHANGELOG.md)
[ "$NOTES" -gt 0 ] || die "the « Non publié » section of CHANGELOG.md is empty"

BRANCH="prep/$TAG"
git switch -q -c "$BRANCH"

# package.json: the top-level version only; package-lock.json: the root and the "" package (first two).
sed -i "0,/^  \"version\": \"$CURRENT\",\$/s//  \"version\": \"$VERSION\",/" package.json
awk -v cur="\"version\": \"$CURRENT\"" -v new="\"version\": \"$VERSION\"" \
  'n < 2 && index($0, cur) { sub(cur, new); n++ } { print }' package-lock.json > package-lock.json.tmp \
  && mv package-lock.json.tmp package-lock.json
[ "$(grep -c "\"version\": \"$VERSION\"" package-lock.json)" -ge 2 ] || die "package-lock.json not updated"

TODAY=$(date +%F)
sed -i "s/^## \[Non publié\]\$/## [Non publié]\n\n## [$VERSION] — $TODAY/" CHANGELOG.md

git add package.json package-lock.json CHANGELOG.md
git commit -q -m "chore(release): $TAG"
git push -q -u origin "$BRANCH"

if command -v gh >/dev/null; then
  NOTE=$(awk -v v="## [$VERSION]" 'index($0, v) == 1 {on=1; next} on && /^## \[/{exit} on' CHANGELOG.md)
  gh pr create --base main --head "$BRANCH" --title "chore(release): $TAG" --body "Release $TAG (CONTRIBUTING.md « Releases »).

$NOTE"
else
  echo "Open the pull request $BRANCH → main on GitHub."
fi
echo "Next: CI green → merge → on the signing workstation: scripts/release/tag.sh $VERSION"
