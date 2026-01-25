import os
import shutil
import subprocess
import sys

BUNDLE_IDS = {
    "iTerm.app": "com.googlecode.iterm2",
    "Apple_Terminal": "com.apple.Terminal",
    "WarpTerminal": "dev.warp.Warp-Stable",
    "kitty": "net.kovidgoyal.kitty",
}


def detect_terminal():
    term_program = os.environ.get("TERM_PROGRAM", "")
    return BUNDLE_IDS.get(term_program, "com.apple.Terminal")


def notify(title, message):
    return; # TODO: call app server endpoint to notify
    if sys.platform == "darwin":
        if shutil.which("terminal-notifier"):
            subprocess.run([
                "terminal-notifier",
                "-title", title,
                "-message", message,
                "-activate", detect_terminal(),
                "-sound", "default"
            ])
        else:
            subprocess.run(["osascript", "-e", f'display notification "{message}" with title "{title}"'])

    elif sys.platform == "linux":
        subprocess.run(["notify-send", title, message, "--urgency=critical"])
