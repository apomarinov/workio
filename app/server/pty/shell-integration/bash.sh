# Shell integration for bash
# Emits OSC 133 sequences for command tracking

# Don't re-initialize if already loaded
[[ -n "$__TERMINAL_INTEGRATION" ]] && return
__TERMINAL_INTEGRATION=1

# OSC 133 sequences:
# A - Prompt start (shell is idle, waiting for input)
# C - Command start (user pressed enter, command about to run)
# D - Command end (command finished, includes exit code)

# Track if we're in a command (to avoid double-firing)
__terminal_integration_in_command=0

__terminal_integration_preexec() {
  # Only emit if we're not already in a command
  # The DEBUG trap fires for every command in a pipeline
  if [[ "$__terminal_integration_in_command" == "0" ]]; then
    __terminal_integration_in_command=1
    # BASH_COMMAND contains the command being executed
    local cmd="${BASH_COMMAND//[^[:print:]]/}"
    printf '\e]133;C;%s\e\\' "$cmd"
  fi
}

__terminal_integration_precmd() {
  local exit_code=$?
  __terminal_integration_in_command=0
  # Command finished with exit code
  printf '\e]133;D;%d\e\\' "$exit_code"
  # Prompt starting (shell is idle)
  printf '\e]133;A\e\\'
}

# Set up DEBUG trap for preexec
trap '__terminal_integration_preexec' DEBUG

# Add to PROMPT_COMMAND for precmd
if [[ -z "$PROMPT_COMMAND" ]]; then
  PROMPT_COMMAND="__terminal_integration_precmd"
else
  PROMPT_COMMAND="__terminal_integration_precmd;$PROMPT_COMMAND"
fi

# Emit initial prompt marker
printf '\e]133;A\e\\'
