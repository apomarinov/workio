import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

# Load environment variables
for env_file in [".env", ".env.local"]:
    load_dotenv(Path(__file__).parent / env_file, override=True)

DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2:1.5b")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")


def is_ollama_running() -> bool:
    try:
        parsed = urlparse(OLLAMA_HOST)
        host = parsed.hostname or "localhost"
        port = parsed.port or 11434
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            s.connect((host, port))
            return True
    except (socket.error, socket.timeout, ValueError):
        return False


def start_ollama() -> bool:
    if not shutil.which("ollama"):
        return False

    subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    for _ in range(10):
        if is_ollama_running():
            return True
        time.sleep(0.5)

    return False


def summarize(text: str) -> dict:
    """
    Summarize text using Ollama.
    Returns: {"result": {"short": str, "long": str} | None, "error": str | None}
    """
    if not shutil.which("ollama"):
        return {"result": None, "error": "Ollama not installed"}

    if not is_ollama_running():
        if not start_ollama():
            return {"result": None, "error": "Failed to start Ollama"}

    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": DEFAULT_MODEL,
                "prompt": text,
                "format": {
                    "type": "object",
                    "properties": {
                        "short": {"type": "string", "description": "Summary in up to 20 words"},
                        "long": {"type": "string", "description": "Summary in up to 200 words"}
                    },
                    "required": ["short", "long"]
                },
                "stream": False
            },
            timeout=60
        )
        response.raise_for_status()
        result = json.loads(response.json().get("response"))
        return {"result": result, "error": None}
    except requests.exceptions.Timeout:
        return {"result": None, "error": "Ollama request timed out"}
    except requests.exceptions.RequestException as e:
        return {"result": None, "error": f"Ollama request failed: {str(e)}"}
    except json.JSONDecodeError as e:
        return {"result": None, "error": f"Failed to parse Ollama response: {str(e)}"}
    except Exception as e:
        return {"result": None, "error": f"Unexpected error: {str(e)}"}
