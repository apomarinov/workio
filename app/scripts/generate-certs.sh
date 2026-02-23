#!/usr/bin/env bash
set -euo pipefail

# Check mkcert is installed
if ! command -v mkcert &>/dev/null; then
  echo "Error: mkcert is not installed."
  echo "Install it with: brew install mkcert"
  exit 1
fi

# Auto-detect local network IP
LOCAL_IP=""
if command -v ifconfig &>/dev/null; then
  LOCAL_IP=$(ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n1)
elif command -v ip &>/dev/null; then
  LOCAL_IP=$(ip -4 addr show scope global | grep inet | awk '{print $2}' | cut -d/ -f1 | head -n1)
fi

if [ -z "$LOCAL_IP" ]; then
  echo "Warning: Could not detect local IP. Using localhost only."
  LOCAL_IP="127.0.0.1"
fi

echo "Detected local IP: $LOCAL_IP"

# Install root CA (if not already installed)
echo ""
echo "Installing mkcert root CA..."
mkcert -install

# Create certs directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$(dirname "$SCRIPT_DIR")/../certs"
mkdir -p "$CERTS_DIR"

# Generate certificate
echo ""
echo "Generating certificates for localhost, 127.0.0.1, $LOCAL_IP..."
mkcert -cert-file "$CERTS_DIR/cert.pem" -key-file "$CERTS_DIR/key.pem" \
  localhost 127.0.0.1 "$LOCAL_IP"

echo ""
echo "Certificates generated at:"
echo "  $CERTS_DIR/cert.pem"
echo "  $CERTS_DIR/key.pem"

# Print iPhone instructions
CA_ROOT=$(mkcert -CAROOT)
echo ""
echo "=========================================="
echo "  iPhone Setup Instructions"
echo "=========================================="
echo ""
echo "1. AirDrop the root CA to your iPhone:"
echo "   $CA_ROOT/rootCA.pem"
echo ""
echo "2. On iPhone, open Settings > General > VPN & Device Management"
echo "   and install the certificate profile."
echo ""
echo "3. Go to Settings > General > About > Certificate Trust Settings"
echo "   and enable full trust for the mkcert root certificate."
echo ""
echo "4. Access the app at: https://$LOCAL_IP:5175"
echo "=========================================="
