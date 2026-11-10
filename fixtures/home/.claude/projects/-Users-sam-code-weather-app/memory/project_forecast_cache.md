---
name: forecast-cache
description: Forecasts are cached for ten minutes per city
metadata:
  type: project
---

The forecast cache keeps each city's forecast for ten minutes (src/cache.ts). Don't lower it: the provider limits requests.
