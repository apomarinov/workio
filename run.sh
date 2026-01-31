#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD=false
DROP_DB=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --rebuild)
            REBUILD=true
            shift
            ;;
        --drop-db)
            DROP_DB=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./run.sh [--rebuild] [--drop-db]"
            exit 1
            ;;
    esac
done

echo "🤖 Claude Dashboard"
echo ""

# Load environment variables (line-by-line to handle special chars in values)
load_env() {
    local file="$1"
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip empty lines and comments
        [[ -z "$line" || "$line" == \#* ]] && continue
        export "$line"
    done < "$file"
}

[[ -f "$SCRIPT_DIR/.env" ]] && load_env "$SCRIPT_DIR/.env"
[[ -f "$SCRIPT_DIR/.env.local" ]] && load_env "$SCRIPT_DIR/.env.local"

# Require DATABASE_URL to be set
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "❌ Error: DATABASE_URL is not set."
    echo "Set it in .env or .env.local, e.g.: DATABASE_URL=postgresql://localhost/claude_dashboard"
    exit 1
fi

# Extract the database name from DATABASE_URL path (e.g. postgresql://host/mydb -> mydb)
DB_NAME="${DATABASE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"

# Build admin URL by replacing db name with a given database
make_admin_url() {
    local db="$1"
    echo "${DATABASE_URL%/*}/${db}"
}

# Verify PostgreSQL is reachable (try target db first, then postgres, then neondb)
PG_REACHABLE=false
for CHECK_DB in "$DB_NAME" "postgres" "neondb"; do
    if psql "$(make_admin_url "$CHECK_DB")" -c "SELECT 1" &>/dev/null; then
        PG_REACHABLE=true
        break
    fi
done

if [[ "$PG_REACHABLE" != "true" ]]; then
    echo "❌ Error: Cannot connect to PostgreSQL at: $DATABASE_URL"
    echo "Check that the server is running and DATABASE_URL is correct."
    exit 1
fi

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is required but not installed."
    exit 1
fi

# Check Python version (need 3.10+ for union type hints)
PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

if [[ $PYTHON_MAJOR -lt 3 ]] || [[ $PYTHON_MAJOR -eq 3 && $PYTHON_MINOR -lt 10 ]]; then
    echo "❌ Error: Python 3.10+ is required (found $PYTHON_VERSION)"
    exit 1
fi

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo "❌ Error: Claude CLI is required but not installed."
    echo "Install it from https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is required but not installed."
    exit 1
fi

# Check for GitHub CLI (gh) — needed for PR checks, status, and project integration
if ! command -v gh &> /dev/null; then
    echo "⚠️ Warning: GitHub CLI (gh) is not installed."
    echo "  PR checks, status updates, and project board features will not work."
    echo "  Install from https://cli.github.com/"
elif ! gh auth status &> /dev/null; then
    echo "⚠️ Warning: GitHub CLI is not authenticated."
    echo "  PR checks, status updates, and project board features will not work."
    echo "  Run 'gh auth login' to authenticate."
fi

# Check for PostgreSQL client (psql)
if ! command -v psql &> /dev/null; then
    echo "❌ Error: PostgreSQL client (psql) is required but not installed."
    echo "Install with: brew install postgresql (macOS) or apt-get install postgresql-client (Linux)"
    exit 1
fi

# ---- Python Setup ----

# Install Python dependencies if needed
if ! python3 -c "import psycopg2" 2>/dev/null; then
    echo "Installing Python dependencies..."
    python3 -m pip install -q python-dotenv psycopg2-binary
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/monitor.py"
chmod +x "$SCRIPT_DIR/setup_hooks.py"

# Update Claude hooks
echo "Updating Claude hooks..."
python3 "$SCRIPT_DIR/setup_hooks.py"

# ---- PostgreSQL Setup ----

echo "Setting up PostgreSQL database: $DB_NAME"

# Drop database if requested
if [[ "$DROP_DB" == true ]]; then
    echo "Dropping database $DB_NAME..."
    psql "$(make_admin_url "postgres")" -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" 2>/dev/null || true
fi

# Create database and run schema if it doesn't exist
if ! psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null; then
    echo "Creating database $DB_NAME..."
    psql "$(make_admin_url "postgres")" -c "CREATE DATABASE \"$DB_NAME\"" 2>/dev/null \
        || { echo "❌ Error: Failed to create database $DB_NAME"; exit 1; }
    echo "Running schema..."
    psql "$DATABASE_URL" -f "$SCRIPT_DIR/schema.sql"
fi

# Load and use nvm to switch to correct Node version if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
    echo "Using nvm to switch to correct Node version..."
    cd "$SCRIPT_DIR/app"
    nvm use
    cd "$SCRIPT_DIR"
fi

# Check Node.js version matches .nvmrc
NVMRC_FILE="$SCRIPT_DIR/app/.nvmrc"
if [[ -f "$NVMRC_FILE" ]]; then
    REQUIRED_NODE_VERSION=$(cat "$NVMRC_FILE" | tr -d '[:space:]')
    CURRENT_NODE_VERSION=$(node -v | sed 's/^v//')
    if [[ "$CURRENT_NODE_VERSION" != "$REQUIRED_NODE_VERSION" ]]; then
        echo "❌ Error: Node.js version mismatch."
        echo "  Required: $REQUIRED_NODE_VERSION (from app/.nvmrc)"
        echo "  Current:  $CURRENT_NODE_VERSION"
        echo "  Run 'nvm use' or 'nvm install $REQUIRED_NODE_VERSION' to switch versions."
        exit 1
    fi
fi

# Build webapp if not built or --rebuild flag is set
if [[ ! -d "$SCRIPT_DIR/app/dist" ]] || [[ "$REBUILD" == true ]]; then
    echo "Building webapp..."
    cd "$SCRIPT_DIR/app"
    npm install
    npm run build
    cd "$SCRIPT_DIR"
fi

# Start the server
echo "✅ Starting server..."
cd "$SCRIPT_DIR/app"
npm start
