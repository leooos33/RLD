#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RLD Docker Log Aggregation
# ═══════════════════════════════════════════════════════════════
# Collects logs from all RLD containers into daily log files
# with automatic rotation (keeps last 7 days).
#
# Setup (cron):
#   crontab -e
#   0 * * * * /home/ubuntu/RLD/docker/scripts/collect-logs.sh
#
# Manual run:
#   ./docker/scripts/collect-logs.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

LOG_DIR="/home/ubuntu/RLD/logs"
RETENTION_DAYS=7
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y-%m-%d_%H:%M:%S)

# Create log directory
mkdir -p "$LOG_DIR"

# Containers to collect from
CONTAINERS=(
    "docker-indexer-1"
    "docker-rates-indexer-1"
    "docker-monitor-bot-1"
    "docker-mm-daemon-1"
    "docker-chaos-trader-1"
)

for CONTAINER in "${CONTAINERS[@]}"; do
    # Extract short name (e.g., "indexer" from "docker-indexer-1")
    NAME=$(echo "$CONTAINER" | sed 's/docker-\(.*\)-1/\1/')
    LOG_FILE="$LOG_DIR/${NAME}_${DATE}.log"

    # Append recent logs (since last hour)
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
        echo "--- $TIMESTAMP ---" >> "$LOG_FILE"
        docker logs "$CONTAINER" --since 1h 2>&1 >> "$LOG_FILE" 2>/dev/null || true
    fi
done

# Aggregate health status
HEALTH_FILE="$LOG_DIR/health_${DATE}.log"
echo "--- $TIMESTAMP ---" >> "$HEALTH_FILE"
docker ps --format "{{.Names}}: {{.Status}}" >> "$HEALTH_FILE"

# Rotate old logs
find "$LOG_DIR" -name "*.log" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

echo "[$TIMESTAMP] Logs collected to $LOG_DIR"
