# Shell integration for SSH terminals (combined bash+zsh)
# Auto-detects shell and installs OSC 133 hooks for command tracking
# This script is injected inline over SSH — no file sourcing needed on remote

# Don't re-initialize if already loaded
[ -n "$__TERMINAL_INTEGRATION" ] && return 0 2>/dev/null
__TERMINAL_INTEGRATION=1

# OSC 133 sequences:
# A - Prompt start (shell is idle, waiting for input)
# C - Command start (user pressed enter, command about to run)
# D - Command end (command finished, includes exit code)

if [ -n "$ZSH_VERSION" ]; then
  # --- zsh ---
  __terminal_integration_preexec() {
    local cmd="${1//[^[:print:]]/}"
    printf '\e]133;C;%s\e\\' "$cmd"
  }
  __terminal_integration_precmd() {
    local exit_code=$?
    printf '\e]133;D;%d\e\\' "$exit_code"
    printf '\e]133;A\e\\'
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec __terminal_integration_preexec
  add-zsh-hook precmd __terminal_integration_precmd
elif [ -n "$BASH_VERSION" ]; then
  # --- bash ---
  __terminal_integration_in_command=0
  __terminal_integration_preexec() {
    if [ "$__terminal_integration_in_command" = "0" ]; then
      __terminal_integration_in_command=1
      local cmd="${BASH_COMMAND//[^[:print:]]/}"
      printf '\e]133;C;%s\e\\' "$cmd"
    fi
  }
  __terminal_integration_precmd() {
    local exit_code=$?
    __terminal_integration_in_command=0
    printf '\e]133;D;%d\e\\' "$exit_code"
    printf '\e]133;A\e\\'
  }
  trap '__terminal_integration_preexec' DEBUG
  if [ -z "$PROMPT_COMMAND" ]; then
    PROMPT_COMMAND="__terminal_integration_precmd"
  else
    PROMPT_COMMAND="__terminal_integration_precmd;$PROMPT_COMMAND"
  fi
fi

# Emit initial prompt marker
printf '\e]133;A\e\\'
