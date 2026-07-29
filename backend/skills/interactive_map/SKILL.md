---
name: interactive-map
description: Show an interactive map view for the given location. Use when the user asks to view, find, or open a place on a map.
---

# Interactive Map Skill

## Instructions
When the user asks to show or find a place on an interactive map, trigger this tool with:
- `skill`: "interactive-map"
- `script`: "index.py"
- `data`: A JSON object with key `location`:
  - The location to show on the map.

The output of this skill should be displayed using the screen as the canvas, rendering the map view across the full viewport rather than inside a small chat panel.
