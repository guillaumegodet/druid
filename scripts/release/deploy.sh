#!/usr/bin/env bash
# Step 3 of a release (CONTRIBUTING.md « Releases »): deploys a signed version tag on the test instance, then —
# once it has been accepted there — on production, with the SAME image.
#   deploy.sh test X.Y.Z
#   deploy.sh prod X.Y.Z [--skip-test-check]      # --skip-test-check: urgent fix or return to an older version
#
# Refuses anything that is not an annotated tag vX.Y.Z signed by an allowed signer, whose package.json carries
# X.Y.Z and whose commit passed the CI. The image is built once per version from a clean checkout of the tag
# (git worktree), never from a working copy. Before production: backup of the Grist doc and of the runtime
# files; after: health check, automatic return to the previous image on failure. Every run is appended to
# the deployment log.
#
# Instance settings (paths, compose files, image names) come from a config file kept with the private data of
# the instance: DRUID_DEPLOY_CONFIG=/path/to/deploy.env (see the variables read below).
set -euo pipefail

die() { echo "deploy: $*" >&2; exit 1; }
say() { echo "deploy: $*"; }

TARGET=${1:-}
VERSION=${2:-}
SKIP_TEST_CHECK=${3:-}
[[ $TARGET == test || $TARGET == prod ]] || die "usage: deploy.sh test|prod X.Y.Z [--skip-test-check]"
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: deploy.sh test|prod X.Y.Z [--skip-test-check]"
[[ -z $SKIP_TEST_CHECK || $SKIP_TEST_CHECK == --skip-test-check ]] || die "unknown option $SKIP_TEST_CHECK"
TAG="v$VERSION"

CONFIG=${DRUID_DEPLOY_CONFIG:-}
[ -n "$CONFIG" ] && [ -r "$CONFIG" ] || die "DRUID_DEPLOY_CONFIG must name the instance config file"
# shellcheck source=/dev/null
. "$CONFIG"
: "${SRC_REPO:?}" "${RELEASES_DIR:?}" "${ALLOWED_SIGNERS:?}" "${GITHUB_REPO:?}" "${DEPLOY_LOG:?}" "${COMPOSE_DIR:?}"
: "${PROD_COMPOSE_FILES:?}" "${PROD_SERVICE:?}" "${PROD_CONTAINER:?}" "${PROD_IMAGE:?}"
: "${TEST_COMPOSE_FILE:?}" "${TEST_CONTAINER:?}" "${TEST_IMAGE:?}"
BACKUP_DIR=${BACKUP_DIR:-}
BACKUP_PATHS=${BACKUP_PATHS:-}
GRIST_ENV_FILE=${GRIST_ENV_FILE:-}
GRIST_API_URL=${GRIST_API_URL:-https://grist.numerique.gouv.fr/api}
MIN_MEM_MB=${MIN_MEM_MB:-2500}
KEEP_VERSIONS=${KEEP_VERSIONS:-3}
KEEP_BACKUPS=${KEEP_BACKUPS:-10}
OPERATOR=${DEPLOY_OPERATOR:-${SUDO_USER:-$(id -un)}}

mkdir -p "$(dirname "$DEPLOY_LOG")"; touch "$DEPLOY_LOG"
# One deployment at a time.
exec 9>"$DEPLOY_LOG.lock"
flock -n 9 || die "another deployment is running"

START=$(date +%s)
SHA=""
IMAGE_ID=""
log_line() {  # result
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%ss\n' "$(date -u +%FT%TZ)" "$OPERATOR" "$TARGET" "$TAG" "${SHA:-?}" \
    "${IMAGE_ID:-?}" "$1" "$(( $(date +%s) - START ))" >> "$DEPLOY_LOG"
}
fail() { log_line "failed: $*"; die "$*"; }

# ── 1. The tag: annotated, signed by an allowed signer, version and CI consistent ─────────────────────────
git -C "$SRC_REPO" fetch -q origin --tags
git -C "$SRC_REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag $TAG not found on origin"
[ "$(git -C "$SRC_REPO" cat-file -t "$TAG")" = tag ] || fail "$TAG is not an annotated tag"
git -C "$SRC_REPO" -c gpg.ssh.allowedSignersFile="$ALLOWED_SIGNERS" verify-tag "$TAG" 2>/dev/null \
  || fail "signature of $TAG missing or not from an allowed signer ($ALLOWED_SIGNERS)"
SHA=$(git -C "$SRC_REPO" rev-parse "$TAG^{commit}")
FOUND=$(git -C "$SRC_REPO" show "$TAG:package.json" | sed -n 's/^  "version": "\([^"]*\)",$/\1/p' | head -1)
[ "$FOUND" = "$VERSION" ] || fail "package.json of $TAG says $FOUND"
CI=$(gh api "repos/$GITHUB_REPO/commits/$SHA/check-runs" --jq '[.check_runs[] | select(.name == "checks") | .conclusion] | first // "none"') \
  || fail "cannot read the CI status of $SHA (gh)"
[ "$CI" = success ] || fail "CI of $SHA: $CI"
say "$TAG = ${SHA:0:12}, signed, CI green"

# ── 2. The image, built once per version from a clean checkout of the tag ──────────────────────────────────
IMAGE="$PROD_IMAGE:$TAG"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  TREE="$RELEASES_DIR/$TAG"
  if [ ! -d "$TREE" ]; then
    mkdir -p "$RELEASES_DIR"
    git -C "$SRC_REPO" worktree add -q --detach "$TREE" "$TAG"
  fi
  [ "$(git -C "$TREE" rev-parse HEAD)" = "$SHA" ] || fail "$TREE is not at $TAG"
  git -C "$TREE" diff --quiet HEAD && [ -z "$(git -C "$TREE" status --porcelain)" ] || fail "$TREE is not clean"
  AVAIL=$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)
  [ "$AVAIL" -ge "$MIN_MEM_MB" ] || fail "only $AVAIL MB of memory available (minimum $MIN_MEM_MB) — build postponed"
  say "building $IMAGE"
  docker build -q -t "$IMAGE" --build-arg GIT_SHA="$SHA" --build-arg BUILD_DATE="$(date -u +%FT%TZ)" \
    --build-arg DRUID_VERSION="$VERSION" "$TREE" >/dev/null || fail "build of $IMAGE"
  docker builder prune -a -f >/dev/null 2>&1 || true
fi
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")" = "$SHA" ] \
  || fail "$IMAGE was not built from $SHA"
IMAGE_ID=$(docker image inspect -f '{{.Id}}' "$IMAGE" | cut -c8-19)

wait_healthy() {  # container → 0 when healthy within 3 minutes
  local status=""
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing)
    [ "$status" = healthy ] && return 0
    [ "$status" = unhealthy ] && return 1
    sleep 3
  done
  return 1
}
running_revision() {  # container → commit of the image it runs
  docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null || true
}

# ── 3a. Test instance ──────────────────────────────────────────────────────────────────────────────────────
if [ "$TARGET" = test ]; then
  docker tag "$IMAGE" "$TEST_IMAGE:latest"
  (cd "$COMPOSE_DIR" && docker compose -f "$TEST_COMPOSE_FILE" up -d --no-build) >/dev/null 2>&1 || fail "start of the test instance"
  wait_healthy "$TEST_CONTAINER" || fail "test instance not healthy"
  [ "$(running_revision "$TEST_CONTAINER")" = "$SHA" ] || fail "test instance does not run $TAG"
  log_line ok
  say "$TAG running on the test instance. After the recette: deploy.sh prod $VERSION"
  exit 0
fi

# ── 3b. Production ─────────────────────────────────────────────────────────────────────────────────────────
if [ -z "$SKIP_TEST_CHECK" ]; then
  awk -F'\t' -v tag="$TAG" '$3 == "test" && $4 == tag && $7 == "ok" {found=1} END {exit !found}' "$DEPLOY_LOG" \
    || fail "$TAG was never deployed on the test instance (deploy.sh test $VERSION first, or --skip-test-check)"
fi

STAMP=$(date +%Y%m%d-%H%M%S)
if [ -n "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  if [ -n "$GRIST_ENV_FILE" ]; then
    DOC=$(sed -n 's/^VITE_GRIST_DOC_ID=//p' "$GRIST_ENV_FILE" | tail -1)
    KEY=$(sed -n 's/^GRIST_API_KEY=//p' "$GRIST_ENV_FILE" | tail -1)
    [ -n "$DOC" ] && [ -n "$KEY" ] || fail "Grist doc or key not found in $GRIST_ENV_FILE"
    OUT="$BACKUP_DIR/grist-$STAMP-before-$TAG.grist"
    (umask 077 && curl -fsS --max-time 600 -H "Authorization: Bearer $KEY" "$GRIST_API_URL/docs/$DOC/download" -o "$OUT") \
      || fail "backup of the Grist doc"
    say "Grist doc saved: $OUT ($(du -h "$OUT" | cut -f1))"
  fi
  if [ -n "$BACKUP_PATHS" ]; then
    # shellcheck disable=SC2086 # BACKUP_PATHS is a space-separated list of paths
    (umask 077 && tar -czf "$BACKUP_DIR/files-$STAMP-before-$TAG.tar.gz" $BACKUP_PATHS 2>/dev/null) || fail "backup of $BACKUP_PATHS"
  fi
  # Keep the KEEP_BACKUPS most recent backups of each kind.
  for kind in grist files; do
    find "$BACKUP_DIR" -maxdepth 1 -name "$kind-*" -type f -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP_BACKUPS + 1))" | cut -d' ' -f2- | xargs -r rm -f
  done
fi

PREVIOUS=$(running_revision "$PROD_CONTAINER")
if docker image inspect "$PROD_IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$PROD_IMAGE:latest" "$PROD_IMAGE:previous"
fi
docker tag "$IMAGE" "$PROD_IMAGE:latest"
# shellcheck disable=SC2086 # PROD_COMPOSE_FILES is a list of -f options
(cd "$COMPOSE_DIR" && docker compose $PROD_COMPOSE_FILES up -d --no-build "$PROD_SERVICE") >/dev/null 2>&1 \
  || say "compose reported an error, checking the container"

if wait_healthy "$PROD_CONTAINER" && [ "$(running_revision "$PROD_CONTAINER")" = "$SHA" ]; then
  log_line ok
  say "$TAG in production (previous commit: ${PREVIOUS:0:12})"
else
  say "production NOT healthy on $TAG: back to the previous image"
  if docker image inspect "$PROD_IMAGE:previous" >/dev/null 2>&1; then
    docker tag "$PROD_IMAGE:previous" "$PROD_IMAGE:latest"
    # shellcheck disable=SC2086
    (cd "$COMPOSE_DIR" && docker compose $PROD_COMPOSE_FILES up -d --no-build "$PROD_SERVICE") >/dev/null 2>&1 || true
    wait_healthy "$PROD_CONTAINER" && say "previous image restored (${PREVIOUS:0:12})"
  fi
  fail "production unhealthy on $TAG, rolled back"
fi

# Data operations of this version (CHANGELOG « Migration »): reminded here, run by hand.
MIGRATION=$(git -C "$SRC_REPO" show "$TAG:CHANGELOG.md" | awk -v v="## [$VERSION]" '
  index($0, v) == 1 {on=1; next} on && /^## \[/ {exit} on && /^### / {mig = ($0 ~ /Migration/); next} on && mig')
[ -n "$(echo "$MIGRATION" | tr -d '[:space:]')" ] && printf 'deploy: data operations to run now (CHANGELOG):\n%s\n' "$MIGRATION"

# Housekeeping: keep the images (and checkouts) of the last KEEP_VERSIONS versions.
docker image ls "$PROD_IMAGE" --format '{{.Tag}}' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -rV | tail -n +"$((KEEP_VERSIONS + 1))" |
  while read -r old; do
    docker image rm "$PROD_IMAGE:$old" >/dev/null 2>&1 || true
    [ -d "$RELEASES_DIR/$old" ] && git -C "$SRC_REPO" worktree remove --force "$RELEASES_DIR/$old" 2>/dev/null || true
  done
exit 0
