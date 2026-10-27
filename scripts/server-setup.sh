#!/bin/bash

# One-time server setup for DC Level App on xibo.space.nova-labs.org
# Creates /opt/dc-level-app and adds a /dc-level route to Apache next to
# the Sound Monitoring Mesh /sound route. Safe to re-run.
#
# Run on the server:  sudo bash ~/dc-level-app-setup.sh

set -euo pipefail

APP_USER="sklosky"
APP_DIR="/opt/dc-level-app"
URL_PATH="/dc-level"
STAGING_DIR="/home/$APP_USER/dc-level-app-staging/frontend"
SITES=(
    /etc/apache2/sites-enabled/000-default.conf
    /etc/apache2/sites-enabled/000-default-le-ssl.conf
)
STAMP=$(date +%s)

# New block goes right before the Xibo catch-all; ProxyPass exclusions must precede "ProxyPass /"
export ANCHOR="    # Xibo - all other traffic goes to Xibo (port 8080)"
export BLOCK="    # DC Level App - Frontend
    Alias $URL_PATH $APP_DIR/frontend
    <Directory $APP_DIR/frontend>
        Options FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    # Exclude DC Level App from root proxy
    ProxyPass $URL_PATH !

"

if [[ $EUID -ne 0 ]]; then
    echo "❌ Run with sudo: sudo bash $0"
    exit 1
fi

# Check every vhost before touching any of them
for f in "${SITES[@]}"; do
    if ! grep -qxF "$ANCHOR" "$f"; then
        echo "❌ Xibo catch-all line not found in $f - nothing changed"
        exit 1
    fi
done

echo "📁 Creating $APP_DIR/frontend (owned by $APP_USER)..."
mkdir -p "$APP_DIR/frontend"
if [[ -d "$STAGING_DIR" ]]; then
    cp -r "$STAGING_DIR/." "$APP_DIR/frontend/"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "🔧 Adding $URL_PATH route to Apache..."
CHANGED=()
for f in "${SITES[@]}"; do
    if grep -q "Alias $URL_PATH " "$f"; then
        echo "  → $f already configured"
        continue
    fi
    cp -p "$f" "$f.backup-$STAMP"
    awk '$0 == ENVIRON["ANCHOR"] { printf "%s", ENVIRON["BLOCK"] } { print }' "$f.backup-$STAMP" > "$f"
    CHANGED+=("$f")
    echo "  → updated $f (backup: $f.backup-$STAMP)"
done

if [[ ${#CHANGED[@]} -gt 0 ]]; then
    echo "🧪 Testing Apache config..."
    if ! apache2ctl configtest; then
        echo "❌ Config test failed - restoring backups"
        for f in "${CHANGED[@]}"; do
            cp -p "$f.backup-$STAMP" "$f"
        done
        exit 1
    fi
    echo "🔄 Reloading Apache..."
    systemctl reload apache2
fi

echo ""
echo "✅ Setup complete"
echo "   http://localhost$URL_PATH/ → $(curl -s -o /dev/null -w '%{http_code}' "http://localhost$URL_PATH/")"
echo "   http://localhost/sound/kiosk.html → $(curl -s -o /dev/null -w '%{http_code}' "http://localhost/sound/kiosk.html")"
