#!/bin/bash
set -e

# Check for brew on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! command -v brew &> /dev/null; then
        echo "Error: Homebrew is required but not installed."
        echo "Install it from https://brew.sh"
        exit 1
    fi
fi

echo " - Installing Python dependencies..."
pip install python-dotenv requests

echo ""
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo " - Checking for terminal-notifier..."
    if ! command -v terminal-notifier &> /dev/null; then
        echo " - Installing terminal-notifier..."
        brew install terminal-notifier
    fi
fi

echo ""
echo " - Checking for Ollama..."
if ! command -v ollama &> /dev/null; then
    echo " - Ollama not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ollama
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://ollama.com/install.sh | sh
    else
        echo "Unsupported OS: $OSTYPE"
        exit 1
    fi
fi

echo ""
echo " - Pulling default model..."
ollama pull qwen2:1.5b

echo ""
echo " - Setup complete!"
