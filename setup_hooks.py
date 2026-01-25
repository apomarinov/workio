#!/usr/bin/env python3
"""
Script to add monitor hooks to Claude settings.json
Appends hooks if they don't already exist.
"""

import json
import os
from pathlib import Path

SETTINGS_PATH = Path.home() / ".claude" / "settings.json"

# Get the directory where this script is located and construct monitor.py path
SCRIPT_DIR = Path(__file__).resolve().parent
MONITOR_COMMAND = str(SCRIPT_DIR / "monitor.py")

# Define all hook types and whether they need a matcher
HOOK_DEFINITIONS = {
    "SessionStart": {"needs_matcher": False},
    "UserPromptSubmit": {"needs_matcher": False},
    "PreToolUse": {"needs_matcher": True, "matcher": "*"},
    "PostToolUse": {"needs_matcher": True, "matcher": "*"},
    "Notification": {"needs_matcher": True, "matcher": "*"},
    "Stop": {"needs_matcher": False},
    "SessionEnd": {"needs_matcher": False},
}


def create_hook_entry(hook_name: str, config: dict) -> dict:
    """Create a hook entry with the monitor command."""
    entry = {
        "hooks": [
            {
                "type": "command",
                "command": MONITOR_COMMAND
            }
        ]
    }
    if config["needs_matcher"]:
        entry["matcher"] = config["matcher"]
    return entry


def hook_exists(hooks_list: list, monitor_command: str, matcher: str = None) -> bool:
    """Check if a hook with the monitor command already exists."""
    for hook_entry in hooks_list:
        # Check matcher if applicable
        if matcher is not None and hook_entry.get("matcher") != matcher:
            continue

        # Check if the monitor command exists in this entry's hooks
        for hook in hook_entry.get("hooks", []):
            if hook.get("type") == "command" and hook.get("command") == monitor_command:
                return True
    return False


def load_settings() -> dict:
    """Load settings from file or return empty dict."""
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH, "r") as f:
            return json.load(f)
    return {}


def save_settings(settings: dict) -> None:
    """Save settings to file."""
    # Ensure directory exists
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)


def setup_hooks() -> None:
    """Main function to set up all monitor hooks."""
    print(f"Loading settings from: {SETTINGS_PATH}")
    settings = load_settings()

    # Ensure hooks section exists
    if "hooks" not in settings:
        settings["hooks"] = {}

    hooks = settings["hooks"]
    added = []
    skipped = []

    for hook_name, config in HOOK_DEFINITIONS.items():
        # Ensure the hook type list exists
        if hook_name not in hooks:
            hooks[hook_name] = []

        matcher = config.get("matcher") if config["needs_matcher"] else None

        # Check if hook already exists
        if hook_exists(hooks[hook_name], MONITOR_COMMAND, matcher):
            skipped.append(hook_name)
            print(f"  [SKIP] {hook_name}: Monitor hook already exists")
        else:
            # Add the hook entry
            hook_entry = create_hook_entry(hook_name, config)
            hooks[hook_name].append(hook_entry)
            added.append(hook_name)
            print(f"  [ADD]  {hook_name}: Added monitor hook")

    # Save settings
    save_settings(settings)

    print(f"\nSummary:")
    print(f"  Added: {len(added)} hooks ({', '.join(added) if added else 'none'})")
    print(f"  Skipped: {len(skipped)} hooks ({', '.join(skipped) if skipped else 'none'})")
    print(f"\nSettings saved to: {SETTINGS_PATH}")


if __name__ == "__main__":
    setup_hooks()
