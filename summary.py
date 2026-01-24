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


def summarize(prompt: str) -> dict:
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
        payload = {
            "model": DEFAULT_MODEL,
            "prompt": prompt,
            "stream": False,
            "raw": True,
            "options": { "temperature": 0.2, "num_predict": 60 }
        }

        response = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        result = response.json().get("response", "").strip()
        return {"result": result, "error": None}
    except requests.exceptions.Timeout:
        return {"result": None, "error": "Ollama request timed out"}
    except requests.exceptions.RequestException as e:
        return {"result": None, "error": f"Ollama request failed: {str(e)}"}
    except Exception as e:
        return {"result": None, "error": f"Unexpected error: {str(e)}"}


def summarize_user(text: str) -> dict:
    """Summarize a user message."""
    return summarize(f"""You are an engineering team leader asking an engineer to work on a task.
        {text}
        """)


def summarize_assistant(text: str, thinking: bool = False) -> dict:
    """Summarize an assistant message."""
    prompt = ""

    if thinking:
        prompt = f"""You are a software engineer working on a task and you are thinking about the task at hand.
            You must summarize what you are currently doing using present continuous tense.
            Do NOT copy any text from EXAMPLES.
            Your output MUST be derived from INPUT and MUST include at least one keyword from INPUT.

            ### EXAMPLES (style only; placeholders)
            INPUT: "The user wants a new commit, not an amend. But there are no changes to commit since we just committed everything. The user probably wants me to reset the last commit and recommit with a better message. Let me do a soft reset and recommit."
            OUTPUT: "Resetting the last commit and recommitting with a better message."
            INPUT: "Now I need to add the system prompt to the payload and update the rest of the request to use the payload variable. Let me read the file again to see the current state and make the next edit."
            OUTPUT: "Adding system prompt to the payload and updating the rest of the request to use the payload variable."
            INPUT: "The user wants me to add a second parameter `output` (bool) to the `summarize_assistant` function. If `output` is True, it should use a different system prompt. Let me read the current state of the file first to see the current `summarize_assistant` function."
            OUTPUT: "Adding a `output` (bool) parameter to the `summarize_assistant` function and updating logic."

            ### INPUT (real)
            {text}
            ### OUTPUT - Single sentence, up to 20 words, be extremely concise, straight to the point
            """
    else:
        prompt = f"""You are a software engineer who finished the task you were working on.
            You must summarize what you have accomplished, using past tense.
            Do NOT copy any text from EXAMPLES.
            Your output MUST be derived from INPUT and MUST include at least one keyword from INPUT.

            ### EXAMPLES (style only; placeholders)
            INPUT: "Done. Renamed to `summary_prompt_worker.py` and updated the reference in `monitor.py`."
            OUTPUT: "Renamed to `summary_prompt_worker.py` and updated the reference in `monitor.py`."
            INPUT: "The model is ignoring the length constraints in the JSON schema. Small models often don't follow schema descriptions well. Let's move the constraints into the system prompt where they'll be more prominent."
            OUTPUT: "Moved length constraints into the system prompt."

            ### INPUT (real)
            {text}
            ### OUTPUT - Single sentence, up to 10 words, be extremely concise, straight to the point
            """
        
    return summarize(prompt)
