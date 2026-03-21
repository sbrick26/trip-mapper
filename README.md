# Trip Mapper

Interactive travel itinerary mapper that turns a Google Sheet into a navigable map with AI-powered parsing and geocoding.

## How It Works

1. User provides a Google Sheets URL and Anthropic API key
2. App fetches sheet tabs (Itinerary, Transportation, Hotels, Flights) via Cloudflare Worker proxy
3. Claude Sonnet 4.6 parses CSV into structured JSON (days → stops with times, emojis, types)
4. Claude geocodes unique locations in a batch call
5. Results are cached in Cloudflare KV (30-day TTL, keyed by CSV hash)
6. Leaflet.js renders an interactive map with a filterable sidebar

Optional Google OAuth connection enables bidirectional editing — add/delete stops in the UI and changes sync back to the sheet.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla JS (ES6+), single `index.html` (~2,400 lines) |
| Maps | Leaflet.js 1.9.4 + CartoDB Dark tiles |
| AI | Claude Sonnet 4.6 (parsing + geocoding) |
| Backend | Cloudflare Worker (`worker.js`) + KV cache |
| Auth | Google OAuth 2.0 (sessionStorage tokens) |
| Data | Google Sheets as database |
| Place Search | Google Maps Places API, Nominatim fallback |

No build step — all dependencies loaded via CDN.

## File Structure

```
index.html     – Entire SPA (HTML + CSS + JS)
worker.js      – Cloudflare Worker proxy (CORS, Claude API, KV cache)
wrangler.toml  – Cloudflare Worker config (KV binding: TRIP_CACHE)
```

## Configuration Constants (in index.html)

```js
SHEET_ID        // Google Sheet ID
WORKER_URL      // Cloudflare Worker endpoint
GOOGLE_CLIENT_ID // OAuth client ID
GOOGLE_MAPS_API_KEY // Places API key
```

## Data Flow

```
Google Sheet CSV → Worker proxy → Claude parse → Claude geocode → Cache (KV)
                                                                      ↓
                                                              Leaflet map + sidebar
```

**Edit flow:** UI change → update in-memory `tripData` → rebuild sidebar/markers → write to Sheets API → update cache with new hash.

## Core Functions

### Data Pipeline
- **`fetchSheetTab(tab)`** — Fetches sheet tab via gviz endpoint (fallback: /export)
- **`claudeParse(csv)`** — Sends CSV to Claude with structured prompt, returns `{tripName, dateRange, cities, days[{stops[]}]}`
- **`claudeGeocode(data)`** — Batch geocodes unique `geoQuery` strings via Claude
- **`buildRowMap(csvText)`** — Maps day/stop positions to sheet row numbers for write-back

### Normalization
- **`normalizeCities()`** — Infers `stop.city` from geoQuery text, sets `day.city` to destination
- **`normalizeStopTypes()`** — Classifies stops as `"activity"` or `"transit"` via emoji/keyword matching

### Rendering
- **`buildApp()`** — Initializes Leaflet map, renders sidebar, binds filters
- **`rebuildDaySidebar(dayId)`** — Rebuilds a single day's timeline DOM
- **`renderMarkers()`** — Creates/updates map markers, fits bounds (maxZoom capped)

### Editing
- **`handleAddSubmit()`** — Adds stop to tripData, writes row to sheet, updates cache
- **`deleteStop(dayId, stopIdx)`** — Removes stop, deletes sheet row (re-fetches for row safety)

## State

```js
tripData          // Parsed itinerary (main data structure)
rawCSVData        // Original CSV (for cache hash comparison)
rowMap            // Sheet row tracking {dayId: {headerRow, stops[]}}
gToken            // Google OAuth access token (sessionStorage)
markerRegistry    // "dayId-stopIdx" → Leaflet marker (O(1) popup lookup)
activeDay         // Currently expanded day ID
```

## Styling

**Theme:** Dark UI with gold accents.

```
--bg: #0d0c0b    --text: #ede9e0    --accent: #c8a87a    --gold: #e8c55b
```

**City colors:** Seoul `#e87c5b` · Tokyo `#e8c55b` · Fuji `#5bbfe8` · Kyoto `#b05be8` · Osaka `#5be8a0` · Nara `#e85bb0`

**Typography:** DM Serif Display (headings), DM Sans (body)

### Layout

**Desktop (>768px):** Fixed 380px sidebar + flexible map.

**Mobile (<768px):** Full-width map with bottom sheet (88px peek, swipeable to 80vh). Day tabs for quick navigation. Touch-optimized targets.

## Worker Routes (`worker.js`)

| Route | Purpose |
|-------|---------|
| `GET /?fetch=<url>` | Proxy sheet CSV (CORS) |
| `GET /?geocode=<query>` | Proxy Nominatim geocoding |
| `GET /?cache_get=<hash>` | Retrieve cached tripData |
| `POST /` | Proxy Anthropic Claude API |
| `POST /cache` | Store tripData in KV (30-day TTL) |
| `POST /cache/delete` | Remove old cache entry |

## Key Design Decisions

- **Single HTML file** — No build tools, instant deploy to GitHub Pages
- **Claude for geocoding** — More accurate than Nominatim for landmarks; understands context
- **CSV hash caching** — Skips Claude + geocoding on repeat loads (~$0.05 saved per hit)
- **Row-level sheet sync** — Fresh fetch before delete to handle concurrent edits
- **Transit filtering** — Transit stops hidden from map by default to reduce clutter
- **sessionStorage for secrets** — API key + OAuth token cleared on tab close
