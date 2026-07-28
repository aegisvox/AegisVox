---
name: system_info
description: Retrieve real-time CPU, RAM, Disk usage, and System OS information. Use whenever the user asks about system performance, specs, memory, disk space, or machine stats.
---

# System Info Skill

## Instructions
When the user asks about hardware usage, system performance, free memory, or OS details, trigger this tool with:
- `skill`: "system_info"
- `script`: "index.py"
- `data`: A JSON object with key `target`:
  - `"all"`: Get CPU, RAM, and Disk metrics.
  - `"cpu"`: Get CPU utilization only.
  - `"memory"`: Get RAM usage details only.
  - `"disk"`: Get storage capacity details only.