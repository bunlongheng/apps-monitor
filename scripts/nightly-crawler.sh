#!/bin/bash
# Nightly Link Crawler - 1:30 AM
# Visits every page in every app, detects crashes, screenshots errors
# Only runs on HUB machines

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROLE_FILE="$SCRIPT_DIR/../machine-role.json"
ROLE="hub"
[ -f "$ROLE_FILE" ] && ROLE=$(python3 -c "import json; print(json.load(open('$ROLE_FILE')).get('role','hub'))" 2>/dev/null || echo "hub")

if [ "$ROLE" = "agent" ]; then
  echo "$(date) - Skipped: machine role is AGENT" >> /tmp/link-crawler.log
  exit 0
fi

export PATH="/Users/bheng/.nvm/versions/node/v20.19.5/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

echo "========================================" >> /tmp/link-crawler.log
echo "Link Crawler - $(date '+%Y-%m-%d %H:%M:%S')" >> /tmp/link-crawler.log
echo "========================================" >> /tmp/link-crawler.log

cd /Users/bheng/Sites/local-apps

# Restart any down apps before crawling
echo "  Pre-crawl: restarting down apps..." >> /tmp/link-crawler.log
for pair in "bheng:3000" "tools:3001" "diagrams:3002" "claude:3003" "3pi:3333" "3pi-poc:3334" "stickies:4444" "vault:4445" "mindmaps:5173" "safe:6100" "drop-web:3010"; do
  IFS=':' read -r name port <<< "$pair"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$port/" 2>/dev/null)
  if [ "$code" = "000" ] || [ "$code" -ge 500 ]; then
    echo "    $name (:$port) down ($code), restarting..." >> /tmp/link-crawler.log
    lsof -ti :"$port" 2>/dev/null | xargs kill -9 2>/dev/null
    rm -f "/Users/bheng/Sites/$name/.next/dev/lock" 2>/dev/null
    launchctl stop "com.bheng.$name" 2>/dev/null
    sleep 1
    launchctl start "com.bheng.$name" 2>/dev/null
  fi
done
sleep 15

node scripts/link-crawler.js >> /tmp/link-crawler.log 2>&1

echo "Done: $(date '+%H:%M:%S')" >> /tmp/link-crawler.log
