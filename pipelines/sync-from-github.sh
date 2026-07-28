#!/usr/bin/env bash
#
# sync-from-github.sh
#
# One-way mirror: GitHub (source of truth) -> Azure DevOps (this repo).
#
# Every run resets the ADO `main` tree to match GitHub `main` EXACTLY,
# except for the paths listed in PRESERVE_PATHS, which are ADO-only and
# always kept from the current ADO tree. Full GitHub history is preserved
# on the initial push; each sync adds one merge-free commit on top of ADO
# main that re-applies GitHub content + the preserved folders.
#
# Auth: uses the caller's `az login` session (az account get-access-token)
# to push to ADO. GitHub is read over anonymous HTTPS (public repo).
#
# Exit codes:
#   0  no changes (ADO already in sync)
#   1  changes pushed
#   2  fatal error (auth, clone, push, divergence)
#
set -euo pipefail

# ---- config -----------------------------------------------------------------
GITHUB_URL="https://github.com/BikS2013/storage-navigator.git"
ADO_URL="https://dev.azure.com/NBGIDP/DevOps_Private/_git/storage-navigator"
BRANCH="main"
# ADO-only paths that must survive every sync (relative to repo root):
# The Dockerfile trio is ADO-only: the shared CI template builds with the repo
# root as context, so COPY paths are API/-prefixed and .dockerignore trims the
# context. GitHub carries the plain in-API/ variant. Without preserving these,
# a sync resets them to the GitHub version and the QA image build breaks.
PRESERVE_PATHS=(
  "configuration"
  "pipelines"
  "API/Dockerfile"
  "API/README.md"
  ".dockerignore"
)
ADO_RESOURCE="499b84ac-1321-427f-aa17-267ca6975798"  # Azure DevOps AAD app id
# -----------------------------------------------------------------------------

die() { echo "ERROR: $*" >&2; exit 2; }
log() { echo ">> $*" >&2; }

command -v git >/dev/null || die "git not found"
command -v az  >/dev/null || die "az not found"

log "acquiring ADO access token via az"
TOKEN="$(az account get-access-token --resource "$ADO_RESOURCE" --query accessToken -o tsv)" \
  || die "az account get-access-token failed - run 'az login'"
[ -n "$TOKEN" ] || die "empty ADO token"

AUTH_HEADER="AUTHORIZATION: bearer $TOKEN"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log "cloning ADO $BRANCH"
git -c http.extraheader="$AUTH_HEADER" clone --quiet --branch "$BRANCH" "$ADO_URL" "$WORK/repo" \
  || die "ADO clone failed"
cd "$WORK/repo"

log "fetching GitHub $BRANCH"
git remote add github "$GITHUB_URL"
git fetch --quiet github "$BRANCH" || die "GitHub fetch failed"

GH_SHA="$(git rev-parse github/$BRANCH)"
log "GitHub $BRANCH = $GH_SHA"

# Snapshot preserved paths from current ADO tree into a stash-free holding dir.
HOLD="$WORK/preserve"
mkdir -p "$HOLD"
for p in "${PRESERVE_PATHS[@]}"; do
  if [ -e "$p" ]; then
    mkdir -p "$HOLD/$(dirname "$p")"
    cp -a "$p" "$HOLD/$(dirname "$p")/"
    log "held preserved path: $p"
  fi
done

# Replace the entire working tree + index with GitHub's tree.
log "resetting tree to GitHub $BRANCH"
git read-tree --reset -u "$GH_SHA"

# Re-apply preserved paths on top of the GitHub tree.
for p in "${PRESERVE_PATHS[@]}"; do
  rm -rf "$p"
  if [ -e "$HOLD/$p" ]; then
    mkdir -p "$(dirname "$p")"
    cp -a "$HOLD/$p" "$(dirname "$p")/"
  fi
done
git add -A -- "${PRESERVE_PATHS[@]}" 2>/dev/null || true
git add -A

if git diff --cached --quiet; then
  log "no changes - ADO already in sync with GitHub $GH_SHA"
  exit 0
fi

COMMIT_MSG="sync: mirror GitHub main ${GH_SHA:0:7} (preserve: ${PRESERVE_PATHS[*]})"
git -c user.name="Storage Navigator Sync" \
    -c user.email="storage-nav-sync@local" \
    commit --quiet -m "$COMMIT_MSG"

log "pushing to ADO $BRANCH"
git -c http.extraheader="$AUTH_HEADER" push origin "HEAD:$BRANCH" \
  || die "ADO push failed (branch may have diverged)"

log "done: pushed sync commit to ADO $BRANCH"
exit 1
