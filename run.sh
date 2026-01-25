#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --rebuild)
            REBUILD=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./run.sh [--rebuild]"
            exit 1
            ;;
    esac
done

echo "Claude Dashboard"
echo ""

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not installed."
    exit 1
fi

# Check Python version (need 3.10+ for union type hints)
PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

if [[ $PYTHON_MAJOR -lt 3 ]] || [[ $PYTHON_MAJOR -eq 3 && $PYTHON_MINOR -lt 10 ]]; then
    echo "Error: Python 3.10+ is required (found $PYTHON_VERSION)"
    exit 1
fi

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo "Error: Claude CLI is required but not installed."
    echo "Install it from https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed."
    exit 1
fi

# Install Python dependencies if needed
if ! python3 -c "import dotenv" 2>/dev/null; then
    echo "Installing Python dependencies..."
    python3 -m pip install -q python-dotenv requests
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/monitor.py"
chmod +x "$SCRIPT_DIR/setup_hooks.py"

# Update Claude hooks
echo "Updating Claude hooks..."
python3 "$SCRIPT_DIR/setup_hooks.py"

# Build webapp if not built or --rebuild flag is set
if [[ ! -d "$SCRIPT_DIR/app/dist" ]] || [[ "$REBUILD" == true ]]; then
    echo "Building webapp..."
    cd "$SCRIPT_DIR/app"
    npm install
    npm run build
    cd "$SCRIPT_DIR"
fi

# Start the server
echo "Starting server..."
cd "$SCRIPT_DIR/app"
npm start
