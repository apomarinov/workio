#!/usr/bin/env python3
"""
Test script for summary functions.

Usage:
    python test_summary.py user "Your text here"
    python test_summary.py assistant "Your text here"
    python test_summary.py assistant --thinking "Your text here"
"""

import json
import sys

from summary import summarize_user, summarize_assistant


def main():
    if len(sys.argv) < 3:
        print("Usage: python test_summary.py <user|assistant> [--thinking] <text>")
        sys.exit(1)

    func_type = sys.argv[1]

    if func_type == "user":
        text = " ".join(sys.argv[2:])
        print(f"Running summarize_user on: {text[:100]}...")
        result = summarize_user(text)
    elif func_type == "assistant":
        thinking = "--thinking" in sys.argv
        args = [a for a in sys.argv[2:] if a != "--thinking"]
        text = " ".join(args)
        print(f"Running summarize_assistant (thinking={thinking}) on: {text[:100]}...")
        result = summarize_assistant(text, thinking=thinking)
    else:
        print(f"Unknown function type: {func_type}")
        print("Use 'user' or 'assistant'")
        sys.exit(1)

    print("\nResult:")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
