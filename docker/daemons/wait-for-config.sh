#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Wait for /config/deployment.json and export all values as env vars.
# Then exec the actual daemon command.
# ═══════════════════════════════════════════════════════════════

set -e

CONFIG_FILE=${CONFIG_FILE:-"/config/deployment.json"}

echo "⏳ Waiting for deployment config at $CONFIG_FILE..."

for i in $(seq 1 120); do
    if [ -f "$CONFIG_FILE" ]; then
        # File exists — check if it has actual content (not empty {})
        RLD_CORE_VAL=$(jq -r '.rld_core // empty' "$CONFIG_FILE" 2>/dev/null)
        if [ -n "$RLD_CORE_VAL" ] && [ "$RLD_CORE_VAL" != "null" ]; then
            echo "✅ Config ready (rld_core=$RLD_CORE_VAL)"
            break
        fi
        # Only log every 10th attempt to avoid spam
        if [ $((i % 10)) -eq 0 ]; then
            echo "  ⏳ Config file exists but incomplete (attempt $i/120)..."
        fi
    fi
    sleep 2
done

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Timed out waiting for $CONFIG_FILE"
    exit 1
fi

# Final validation — ensure the config is complete
RLD_CORE_VAL=$(jq -r '.rld_core // empty' "$CONFIG_FILE" 2>/dev/null)
if [ -z "$RLD_CORE_VAL" ] || [ "$RLD_CORE_VAL" = "null" ]; then
    echo "❌ Config file exists but rld_core is missing or null"
    cat "$CONFIG_FILE"
    exit 1
fi

# Export all config values as env vars (only if not already set)
echo "📋 Loading config..."

export_if_unset() {
    local KEY=$1 VALUE=$2
    if [ -z "${!KEY}" ]; then
        export "$KEY=$VALUE"
        echo "  $KEY=$VALUE"
    fi
}

export_if_unset "RLD_CORE"        "$(jq -r '.rld_core'        "$CONFIG_FILE")"
export_if_unset "TWAMM_HOOK"      "$(jq -r '.twamm_hook'      "$CONFIG_FILE")"
export_if_unset "MARKET_ID"       "$(jq -r '.market_id'       "$CONFIG_FILE")"
export_if_unset "WAUSDC"          "$(jq -r '.wausdc'          "$CONFIG_FILE")"
export_if_unset "POSITION_TOKEN"  "$(jq -r '.position_token'  "$CONFIG_FILE")"
export_if_unset "BROKER_FACTORY"  "$(jq -r '.broker_factory'  "$CONFIG_FILE")"
export_if_unset "SWAP_ROUTER"     "$(jq -r '.swap_router'     "$CONFIG_FILE")"
export_if_unset "POOL_MANAGER"    "$(jq -r '.pool_manager'    "$CONFIG_FILE")"
export_if_unset "TOKEN0"          "$(jq -r '.token0'          "$CONFIG_FILE")"
export_if_unset "TOKEN1"          "$(jq -r '.token1'          "$CONFIG_FILE")"
export_if_unset "MOCK_ORACLE"     "$(jq -r '.mock_oracle'     "$CONFIG_FILE")"
export_if_unset "MOCK_ORACLE_ADDR" "$(jq -r '.mock_oracle'    "$CONFIG_FILE")"

echo ""
echo "🚀 Starting: $@"
exec "$@"
