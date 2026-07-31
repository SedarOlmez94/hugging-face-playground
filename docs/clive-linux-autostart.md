# Linux autostart for Clive

This repo now includes a simple Linux startup launcher for Clive.

## What it does

- Creates a desktop autostart entry at ~/.config/autostart/clive.desktop
- Launches [start-clive.sh](../start-clive.sh) on login
- Opens Clive in a terminal session using the current default model or CLIVE_MODEL

## Prerequisites

- Clive must be installed and available on PATH
- Install it with:

```bash
cd clive
cargo install --path .
```

## Notes

- The launcher runs Clive in an interactive session.
- You can change the default model by exporting CLIVE_MODEL before login or editing the shell script.
- To disable it later, remove the desktop entry from ~/.config/autostart/.
