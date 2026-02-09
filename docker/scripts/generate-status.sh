#!/bin/bash
# generate-status.sh — Collects comprehensive system metrics → status.json
# Cron: * * * * * sudo /home/ubuntu/RLD/docker/scripts/generate-status.sh

set -euo pipefail

OUTPUT="/home/ubuntu/RLD/dashboard/status.json"
HISTORY="/home/ubuntu/RLD/dashboard/history.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── System ──
DISK_TOTAL=$(df -BG / | awk 'NR==2{print $2}' | tr -d 'G')
DISK_USED=$(df -BG / | awk 'NR==2{print $3}' | tr -d 'G')
DISK_FREE=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')
DISK_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%')
MEM_TOTAL=$(free -m | awk '/Mem/{print $2}')
MEM_USED=$(free -m | awk '/Mem/{print $3}')
MEM_AVAIL=$(free -m | awk '/Mem/{print $7}')
LOAD_1=$(cat /proc/loadavg | awk '{print $1}')
LOAD_5=$(cat /proc/loadavg | awk '{print $2}')
LOAD_15=$(cat /proc/loadavg | awk '{print $3}')
UPTIME_SECS=$(awk '{print int($1)}' /proc/uptime)
CPU_CORES=$(nproc)
SWAP_TOTAL=$(free -m | awk '/Swap/{print $2}')
SWAP_USED=$(free -m | awk '/Swap/{print $3}')

# ── Containers with stats ──
containers_json="["
first=true
while IFS='|' read -r name cpu mem netio; do
  [ -z "$name" ] && continue
  name_clean=$(echo "$name" | xargs)
  cpu_clean=$(echo "$cpu" | xargs | tr -d '%')
  mem_clean=$(echo "$mem" | xargs)
  net_clean=$(echo "$net" | xargs | sed 's/"/\\"/g')
  
  # Get status + restart count
  status_line=$(docker ps -a --filter "name=$name_clean" --format "{{.Status}}" 2>/dev/null | head -1)
  restart_count=$(docker inspect --format '{{.RestartCount}}' "$name_clean" 2>/dev/null || echo "0")
  started_at=$(docker inspect --format '{{.State.StartedAt}}' "$name_clean" 2>/dev/null | cut -d'.' -f1 || echo "")
  
  health="running"
  if echo "$status_line" | grep -q "(healthy)"; then health="healthy"
  elif echo "$status_line" | grep -q "(unhealthy)"; then health="unhealthy"
  elif echo "$status_line" | grep -q "Exited"; then health="stopped"; fi
  
  uptime_str=$(echo "$status_line" | sed 's/ (healthy)//' | sed 's/ (unhealthy)//')
  ports=$(docker ps --filter "name=$name_clean" --format "{{.Ports}}" 2>/dev/null | head -1 | sed 's/"/\\"/g')

  if [ "$first" = true ]; then first=false; else containers_json+=","; fi
  containers_json+="{\"name\":\"$name_clean\",\"status\":\"$health\",\"uptime\":\"$uptime_str\",\"cpu\":$cpu_clean,\"memory\":\"$mem_clean\",\"network\":\"$net_clean\",\"restarts\":$restart_count,\"started\":\"$started_at\",\"ports\":\"$ports\"}"
done < <(docker stats --no-stream --format "{{.Names}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}" 2>/dev/null || true)

# Add stopped containers
while IFS='|' read -r name status_line; do
  [ -z "$name" ] && continue
  name_clean=$(echo "$name" | xargs)
  # Skip if already in list
  echo "$containers_json" | grep -q "\"$name_clean\"" && continue
  uptime_str=$(echo "$status_line" | xargs)
  if [ "$first" = true ]; then first=false; else containers_json+=","; fi
  containers_json+="{\"name\":\"$name_clean\",\"status\":\"stopped\",\"uptime\":\"$uptime_str\",\"cpu\":0,\"memory\":\"0B / 0B\",\"network\":\"0B / 0B\",\"restarts\":0,\"started\":\"\",\"ports\":\"\"}"
done < <(docker ps -a --filter "status=exited" --format "{{.Names}}|{{.Status}}" 2>/dev/null || true)
containers_json+="]"

# ── API health + response times ──
rates_rt=$(curl -so /dev/null -w "%{time_total}" -m 3 http://localhost:8081/ 2>/dev/null || echo "-1")
sim_rt=$(curl -so /dev/null -w "%{time_total}" -m 3 http://localhost:8080/ 2>/dev/null || echo "-1")
bot_rt=$(curl -so /dev/null -w "%{time_total}" -m 3 http://localhost:8082/health 2>/dev/null || echo "-1")
nginx_rt=$(curl -so /dev/null -w "%{time_total}" -m 3 https://rld.fi/ 2>/dev/null || echo "-1")

rates_ok=$([ "$rates_rt" != "-1" ] && echo "true" || echo "false")
sim_ok=$([ "$sim_rt" != "-1" ] && echo "true" || echo "false")
bot_ok=$([ "$bot_rt" != "-1" ] && echo "true" || echo "false")
nginx_ok=$([ "$nginx_rt" != "-1" ] && echo "true" || echo "false")

rates_block=$(curl -sf -m 2 http://localhost:8081/ 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('last_indexed_block',''))" 2>/dev/null || echo "")

# ── Anvil ──
anvil_ok="false"
anvil_block=""
anvil_resp=$(curl -sf -m 2 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 2>/dev/null)
if [ -n "$anvil_resp" ]; then
  anvil_ok="true"
  anvil_block=$(echo "$anvil_resp" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null || echo "")
fi

# ── SSL ──
SSL_EXPIRY="unknown"; SSL_DAYS="0"
if command -v certbot &>/dev/null; then
  SSL_EXPIRY=$(sudo certbot certificates 2>/dev/null | grep "Expiry" | head -1 | awk '{print $3}' || echo "unknown")
  SSL_DAYS=$(sudo certbot certificates 2>/dev/null | grep "VALID:" | head -1 | grep -oP '\d+(?= days)' || echo "0")
fi

# ── Nginx ──
if sudo nginx -t >/dev/null 2>&1; then nginx_conf_ok="true"; else nginx_conf_ok="false"; fi

# ── Git ──
GIT_COMMIT=$(cd /home/ubuntu/RLD && git log -1 --format="%h" 2>/dev/null || echo "?")
GIT_MSG=$(cd /home/ubuntu/RLD && git log -1 --format="%s" 2>/dev/null | head -c 80 | sed 's/"/\\"/g' || echo "?")
GIT_TIME=$(cd /home/ubuntu/RLD && git log -1 --format="%cI" 2>/dev/null || echo "")
GIT_AUTHOR=$(cd /home/ubuntu/RLD && git log -1 --format="%an" 2>/dev/null || echo "?")

# ── Docker ──
DANGLING=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l)
IMG_SIZE=$(docker system df --format "{{.Size}}" 2>/dev/null | head -1 || echo "0")
IMG_ACTIVE=$(docker images --filter "dangling=false" -q 2>/dev/null | wc -l)
IMG_TOTAL=$(docker images -q 2>/dev/null | wc -l)

# ── Network connections ──
ESTAB=$(ss -t state established 2>/dev/null | wc -l)
LISTEN=$(ss -tlnp 2>/dev/null | tail -n +2 | wc -l)

# ── Recent errors from logs ──
ERR_COUNT=0
if ls /home/ubuntu/RLD/logs/*$(date +%Y-%m-%d)*.log >/dev/null 2>&1; then
  _ec=$(cat /home/ubuntu/RLD/logs/*$(date +%Y-%m-%d)*.log 2>/dev/null | grep -ic "error\|exception\|traceback\|fatal" 2>/dev/null) && ERR_COUNT=$_ec || ERR_COUNT=0
fi

# ── History tracking (keep last 60 data points = ~1 hour) ──
if [ -f "$HISTORY" ]; then
  HIST=$(python3 -c "
import json,sys
try:
  h=json.load(open('$HISTORY'))
  h['load'].append($LOAD_1)
  h['mem'].append(round($MEM_USED/$MEM_TOTAL*100,1))
  h['disk'].append($DISK_PCT)
  h['block'].append(${rates_block:-0})
  for k in h: h[k]=h[k][-60:]
  json.dump(h,sys.stdout)
except: json.dump({'load':[$LOAD_1],'mem':[round($MEM_USED/$MEM_TOTAL*100,1)],'disk':[$DISK_PCT],'block':[${rates_block:-0}]},sys.stdout)
" 2>/dev/null)
else
  HIST="{\"load\":[$LOAD_1],\"mem\":[$(python3 -c "print(round($MEM_USED/$MEM_TOTAL*100,1))")],\"disk\":[$DISK_PCT],\"block\":[${rates_block:-0}]}"
fi
echo "$HIST" > "$HISTORY"

# ── Write JSON ──
cat > "$OUTPUT" << ENDJSON
{
  "timestamp": "$TIMESTAMP",
  "system": {
    "uptime_secs": $UPTIME_SECS,
    "load": [$LOAD_1, $LOAD_5, $LOAD_15],
    "cpu_cores": $CPU_CORES,
    "disk": {"total_gb":$DISK_TOTAL,"used_gb":$DISK_USED,"free_gb":$DISK_FREE,"percent":$DISK_PCT},
    "memory": {"total_mb":$MEM_TOTAL,"used_mb":$MEM_USED,"available_mb":$MEM_AVAIL},
    "swap": {"total_mb":$SWAP_TOTAL,"used_mb":$SWAP_USED},
    "connections": {"established":$ESTAB,"listening":$LISTEN},
    "errors_today": $ERR_COUNT
  },
  "containers": $containers_json,
  "services": {
    "nginx": {"healthy":$nginx_conf_ok,"response_ms":$(python3 -c "print(int(float('${nginx_rt}')*1000))" 2>/dev/null || echo -1)},
    "rates_indexer": {"healthy":$rates_ok,"response_ms":$(python3 -c "print(int(float('${rates_rt}')*1000))" 2>/dev/null || echo -1),"last_block":"$rates_block"},
    "sim_indexer": {"healthy":$sim_ok,"response_ms":$(python3 -c "print(int(float('${sim_rt}')*1000))" 2>/dev/null || echo -1)},
    "monitor_bot": {"healthy":$bot_ok,"response_ms":$(python3 -c "print(int(float('${bot_rt}')*1000))" 2>/dev/null || echo -1)},
    "anvil": {"healthy":$anvil_ok,"block":"$anvil_block"}
  },
  "ssl": {"expiry":"$SSL_EXPIRY","days_remaining":${SSL_DAYS:-0}},
  "git": {"commit":"$GIT_COMMIT","message":"$GIT_MSG","time":"$GIT_TIME","author":"$GIT_AUTHOR"},
  "docker": {"dangling_images":$DANGLING,"images_size":"$IMG_SIZE","active":$IMG_ACTIVE,"total":$IMG_TOTAL},
  "history": $HIST
}
ENDJSON

echo "[$(date)] Status updated → $OUTPUT"
