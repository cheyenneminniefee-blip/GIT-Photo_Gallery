---
name: Workflow restarts
description: Replit workflow command changes may not replace the currently running process until an explicit restart.
---

When changing a workflow's command, explicitly restart the managed workflow before checking behavior or logs.

**Why:** A workflow configuration update can be visible while the previous server process continues serving requests, which can make validation report results from the wrong runtime.

**How to apply:** After workflow or run-command changes, restart once, confirm the startup log identifies the intended runtime, then test the app through the preview.