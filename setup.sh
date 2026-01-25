#!/bin/bash
set -e

echo "Checking dependencies..."
echo ""

# Check for Python 3
echo " - Checking for Python 3..."
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
echo "   Found Python $PYTHON_VERSION"

# Check for pip
echo " - Checking for pip..."
if ! command -v pip3 &> /dev/null && ! python3 -m pip --version &> /dev/null; then
    echo "Error: pip is required but not installed."
    exit 1
fi

# Check for brew on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo " - Checking for Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "Error: Homebrew is required but not installed."
        echo "Install it from https://brew.sh"
        exit 1
    fi
fi

echo ""
echo " - Installing Python dependencies..."
python3 -m pip install python-dotenv requests

echo ""
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo " - Checking for terminal-notifier..."
    if ! command -v terminal-notifier &> /dev/null; then
        echo " - Installing terminal-notifier..."
        brew install terminal-notifier
    fi
fi

# echo ""
# echo " - Checking for Ollama..."
# if ! command -v ollama &> /dev/null; then
#     echo " - Ollama not found. Installing..."
#     if [[ "$OSTYPE" == "darwin"* ]]; then
#         brew install ollama
#     elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
#         curl -fsSL https://ollama.com/install.sh | sh
#     else
#         echo "Unsupported OS: $OSTYPE"
#         exit 1
#     fi
# fi

# echo ""
# echo " - Pulling default model..."
# ollama pull qwen2:1.5b

echo ""
echo " - Setup complete!"
