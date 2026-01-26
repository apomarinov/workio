# Shell integration for zsh
# Emits OSC 133 sequences for command tracking

# Don't re-initialize if already loaded
[[ -n "$__TERMINAL_INTEGRATION" ]] && return
__TERMINAL_INTEGRATION=1

# OSC 133 sequences:
# A - Prompt start (shell is idle, waiting for input)
# C - Command start (user pressed enter, command about to run)
# D - Command end (command finished, includes exit code)

__terminal_integration_preexec() {
  # $1 contains the command being executed
  # Strip non-printable characters for safety
  local cmd="${1//[^[:print:]]/}"
  printf '\e]133;C;%s\e\\' "$cmd"
}

__terminal_integration_precmd() {
  local exit_code=$?
  # Command finished with exit code
  printf '\e]133;D;%d\e\\' "$exit_code"
  # Prompt starting (shell is idle)
  printf '\e]133;A\e\\'
}

# Load zsh hooks module and register our hooks
autoload -Uz add-zsh-hook
add-zsh-hook preexec __terminal_integration_preexec
add-zsh-hook precmd __terminal_integration_precmd

# Emit initial prompt marker
printf '\e]133;A\e\\'
