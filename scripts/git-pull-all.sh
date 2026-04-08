#!/bin/bash
# Git Pull All Repos - 12 AM daily
# Syncs latest code from GitHub before nightly jobs run
# Only runs on HUB machines

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROLE_FILE="$SCRIPT_DIR/../machine-role.json"
ROLE="hub"
[ -f "$ROLE_FILE" ] && ROLE=$(python3 -c "import json; print(json.load(open('$ROLE_FILE')).get('role','hub'))" 2>/dev/null || echo "hub")

if [ "$ROLE" = "agent" ]; then
  echo "$(date) - Skipped: machine role is AGENT" >> /tmp/git-pull-all.log
  exit 0
fi

LOG="/tmp/git-pull-all.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

export PATH="/Users/bheng/.nvm/versions/node/v20.19.5/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

echo "========================================" >> "$LOG"
echo "Git Pull All - $TIMESTAMP" >> "$LOG"
echo "========================================" >> "$LOG"

REPOS=(
  "/Users/bheng/Sites/bheng"
  "/Users/bheng/Sites/tools"
  "/Users/bheng/Sites/diagrams"
  "/Users/bheng/Sites/claude"
  "/Users/bheng/Sites/3pi"
  "/Users/bheng/Sites/3pi-poc"
  "/Users/bheng/Sites/stickies"
  "/Users/bheng/Sites/vault"
  "/Users/bheng/Sites/mindmaps"
  "/Users/bheng/Sites/safe"
  "/Users/bheng/Sites/drop"
  "/Users/bheng/Sites/local-apps"
)

PULLED=0
FAILED=0

for dir in "${REPOS[@]}"; do
  name=$(basename "$dir")
  if [ ! -d "$dir/.git" ]; then
    echo "  SKIP $name - not a git repo" >> "$LOG"
    continue
  fi

  cd "$dir"
  OUTPUT=$(git pull --ff-only 2>&1)
  EXIT=$?

  if [ $EXIT -eq 0 ]; then
    if echo "$OUTPUT" | grep -q "Already up to date"; then
      echo "  OK $name - up to date" >> "$LOG"
    else
      echo "  PULL $name - updated" >> "$LOG"
      echo "  $OUTPUT" | head -3 >> "$LOG"
      PULLED=$((PULLED + 1))
    fi
  else
    echo "  FAIL $name - $OUTPUT" >> "$LOG"
    FAILED=$((FAILED + 1))
  fi
done

echo "" >> "$LOG"
echo "SUMMARY: $PULLED updated, $FAILED failed" >> "$LOG"

exit $FAILED
