#!/usr/bin/env bash
# Step 2 of a release (CONTRIBUTING.md « Releases »), on the workstation that holds the signing key — never on
# the server: creates the SIGNED annotated tag vX.Y.Z on the release commit of main and pushes it. The
# production deployment refuses any tag that is not signed by a key of the allowed signers.
#   scripts/release/tag.sh 1.0.0
# One-off setup: git config --global gpg.format ssh; git config --global user.signingkey ~/.ssh/id_ed25519.pub
set -euo pipefail

die() { echo "tag: $*" >&2; exit 1; }

VERSION=${1:-}
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: tag.sh X.Y.Z"
TAG="v$VERSION"
cd "$(git rev-parse --show-toplevel)"

[ "$(git config --get gpg.format || true)" = ssh ] || die "signing not configured: git config --global gpg.format ssh"
[ -n "$(git config --get user.signingkey || true)" ] || die "signing key not configured: git config --global user.signingkey ~/.ssh/id_ed25519.pub"
git diff --quiet HEAD || die "uncommitted changes"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "switch to main first (git switch main)"
git pull -q --ff-only origin main
git fetch -q origin --tags
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists"

FOUND=$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' package.json | head -1)
[ "$FOUND" = "$VERSION" ] || die "package.json says $FOUND: merge the release pull request (prepare.sh $VERSION) first"

git tag -s -a "$TAG" -m "Druid $VERSION"
if [ -n "$(git config --get gpg.ssh.allowedSignersFile || true)" ]; then
  git tag -v "$TAG"
fi
git push origin "$TAG"
echo "Tag $TAG pushed ($(git rev-parse --short "$TAG^{commit}")). Next, on the server: deploy.sh test $VERSION, recette, deploy.sh prod $VERSION"
