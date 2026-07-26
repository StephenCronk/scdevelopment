#!/usr/bin/env bash
#
# Publish the built site to the `gh-pages` branch.
#
# GitHub Pages cannot build a Vite project itself — pointed at the repo root it
# serves the source, and `index.html` there references `/src/main.ts`, which
# Pages hands back as `video/mp2t` so the browser refuses to run it. The result
# is an unstyled page with no canvas. This publishes `dist/` instead.
#
# Deliberately append-only: each run commits on top of the existing branch, so
# the push is always a fast-forward and never needs --force.
#
# The Actions workflow in .github/workflows/deploy.yml does the same thing
# automatically; this exists because pushing that file requires a token scope
# the stored credential does not have.

set -euo pipefail

cd "$(dirname "$0")/.."
WORKTREE=.deploy
BRANCH=gh-pages

npm run build

# Fetch first so we extend the remote branch rather than diverging from it.
git fetch origin "$BRANCH" --quiet 2>/dev/null || true

rm -rf "$WORKTREE"
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git worktree add "$WORKTREE" -B "$BRANCH" "origin/$BRANCH" --quiet
else
  echo "No remote $BRANCH yet — creating it."
  git worktree add --detach "$WORKTREE" --quiet
  git -C "$WORKTREE" checkout --orphan "$BRANCH" --quiet
  git -C "$WORKTREE" rm -rf --cached . >/dev/null 2>&1 || true
fi

# Replace the published contents wholesale so deleted assets don't linger.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -R dist/. "$WORKTREE"/
touch "$WORKTREE/.nojekyll"

git -C "$WORKTREE" add -A
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "Nothing changed — already published."
else
  git -C "$WORKTREE" commit -q -m "Deploy $(git rev-parse --short HEAD)"
  git -C "$WORKTREE" push -u origin "$BRANCH"
  echo "Published to $BRANCH."
fi

git worktree remove "$WORKTREE" --force
