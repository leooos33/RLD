#!/bin/bash
# Idempotently ensures a /docs/ location block exists in nginx config, then reloads.

NGINX_CONF="/etc/nginx/sites-available/rld.fi"

# First, de-duplicate any existing /docs/ blocks down to exactly one
sudo python3 - <<'PYEOF'
import sys

conf = open('/etc/nginx/sites-available/rld.fi').read()

# Remove all existing /docs/ location blocks (however many there are)
import re
cleaned = re.sub(
    r'\n?\s*# VitePress docs[^\n]*\n\s*location /docs/ \{\n\s*try_files[^\n]+;\n\s*\}\n?',
    '',
    conf
)

# Insert exactly one /docs/ block before the SPA fallback
docs_block = """
    # VitePress docs — static files, no SPA fallback
    location /docs/ {
        try_files $uri $uri/ $uri.html =404;
    }
"""

spa_marker = '    # SPA fallback'
if spa_marker in cleaned:
    cleaned = cleaned.replace(spa_marker, docs_block + '\n    # SPA fallback', 1)
    open('/etc/nginx/sites-available/rld.fi', 'w').write(cleaned)
    print("✅ /docs/ location block applied")
else:
    print("❌ Could not find SPA fallback marker — check config manually", file=sys.stderr)
    sys.exit(1)
PYEOF

if [ $? -ne 0 ]; then
    echo "❌ Config patch failed"
    exit 1
fi

sudo nginx -t && sudo systemctl reload nginx && echo "✅ nginx reloaded successfully"
