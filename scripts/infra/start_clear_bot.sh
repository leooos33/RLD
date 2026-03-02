#!/bin/bash
# Start the JTM Clear Auction Arbitrage Bot
# Uses Anvil account 9 by default (must be pre-funded with waUSDC)
#
# Fund the bot first:
#   BOT_ADDR=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
#   scripts/actions/fund.sh "$BOT_ADDR" "0x2a871d..." 50000
#
# Usage: start_clear_bot.sh

set -e
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "🧹 Starting JTM Clear Auction Bot..."
cd "$ROOT_DIR/backend"
exec python3 tools/clear_bot.py "$@"
