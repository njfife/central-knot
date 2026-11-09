# UI visual reference

How the earlier app looked and felt, for reproducing its appearance. This covers appearance only. The words visible in the screenshots are old copy and are not requirements. Sizes are CSS px at 100% text size; all of them were rem-based (1rem = 16px), so text zoom scales the whole layout and triggers the same collapses.

Overall character: a dense, quiet desktop tool. Near-black or white flat surfaces, 1px hairlines instead of fills, one blue accent used sparingly, muted grey for almost everything secondary, colour reserved for status glyphs. Nothing floats except menus, popovers, tooltips and one modal sheet.

## Reference screenshots

| Subject | Dark | Light |
|---|---|---|
| Overview matrix | [overview-dark](ui-reference/overview-dark.png) | [overview-light](ui-reference/overview-light.png) |
| List with item detail | [list-detail-dark](ui-reference/list-detail-dark.png) | [list-detail-light](ui-reference/list-detail-light.png) |
| Harness cards | [harness-cards-dark](ui-reference/harness-cards-dark.png) | [harness-cards-light](ui-reference/harness-cards-light.png) |
| Review side panel | [review-panel-dark](ui-reference/review-panel-dark.png) | [review-panel-light](ui-reference/review-panel-light.png) |
| Narrow window (960×640) | [narrow-overview-dark](ui-reference/narrow-overview-dark.png) | [narrow-detail-light](ui-reference/narrow-detail-light.png) |
| Empty states | [empty-filter-dark](ui-reference/empty-filter-dark.png) | [empty-state-light](ui-reference/empty-state-light.png) |
| Selected matrix row, docked item panel | [overview-selected-row-dark](ui-reference/overview-selected-row-dark.png) | |
| Popover | [key-popover-dark](ui-reference/key-popover-dark.png) | |

The status bar is visible at the bottom of every screenshot.

## Colour

Theme follows the OS by default, with a manual System / Light / Dark choice. Values in parentheses are what the translucent value renders as on the dark panel, confirmed by pixel sampling. Hex values beside oklch are conversions, also matched against the screenshots.

| Role | Light | Dark |
|---|---|---|
| App background (almost never visible) | `#fbfbfc` | `#000000` |
| Panel: header, content, side panel, cards, popovers | `#ffffff` | `#0a0a0a` |
| Chrome: sidebar, status bar, matrix section rows | `#fafafa` | `#0a0a0a` |
| Hairline border | `#e4e4e7` | `rgb(255 255 255 / 8%)` (`#1d1d1d`) |
| Control border: inputs, selects, outline buttons | `#d4d4d8` | `rgb(255 255 255 / 11%)` (`#242424`) |
| Primary text | `#18181b` | `#f5f5f5` |
| Muted text and icons | `#6b6b74` | `#a3a3a3` |
| Faint glyphs | `#8a8a93` | `#6b6b6b` |
| Hover fill; secondary button fill | `#f4f4f5` | `rgb(255 255 255 / 6%)` (`#191919`) |
| Pressed fill; hover on secondary, outline and ghost buttons | `#e4e4e7` | `rgb(255 255 255 / 10%)` (`#222222`) |
| Current nav item fill | `#f4f4f5` | `rgb(255 255 255 / 8%)` (`#1d1d1d`) |
| Accent: primary button, logo tile, selection bar | `oklch(0.49 0.22 264)` ≈ `#1a4eda` | `oklch(0.57 0.21 264)` ≈ `#346bf1` |
| Accent hover | `oklch(0.45 0.22 264)` ≈ `#0f41cc` | `oklch(0.62 0.2 264)` ≈ `#457cfd` |
| Accent text and icons: links, current nav icon | `oklch(0.49 0.22 264)` ≈ `#1a4eda` | `oklch(0.72 0.14 264)` ≈ `#77a2fc` |
| Text on accent | `#ffffff` | `#ffffff` |
| Focus ring | `oklch(0.49 0.22 264)` ≈ `#1a4eda` | `oklch(0.62 0.2 264)` ≈ `#457cfd` |
| Selected row tint: accent at 8% / 16% | ≈ `#edf1fc` | ≈ `#10192f` |

Status roles. Tinted surfaces are the base colour at 8% (light) or 16% (dark) over the panel; the opaque approximations are for that panel colour.

| Role | Base | Text and glyph, light / dark | Surface, light / dark |
|---|---|---|---|
| Danger | `#ef4444` (strong fill `#dc2626`) | `#b91c1c` / `#f87171` | ≈ `#fef0f0` / `#2f1313` |
| Warning | `#f59e0b` | `#b45309` / `#fbbf24` | ≈ `#fef7eb` / `#30220a` |
| Success | `#10b981` | `#047857` / `#34d399` | ≈ `#ecf9f5` / `#0b261d` |
| Info | `#0ea5e9` | `#0369a1` / `#38bdf8` | ≈ `#ecf8fd` / `#0b232e` |

Elevation. There is no distinct raised colour: raised things use the panel fill plus a border and the following.

- Small lift (cards, inputs, selects, outline and primary buttons, active segment): light `0 1px 2px rgb(0 0 0 / 5%)`; dark no shadow.
- Top highlight on the same elements, plus popovers: dark `inset 0 1px 0 rgb(255 255 255 / 6%)`; none in light.
- Overlay shadow (popovers, tooltips, sheet): light `0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%)`; dark none.
- Modal backdrop: black at 20% light, 60% dark.

## Type

- Sans: Inter Variable, then `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif`. OpenType features `"cv11" 1, "ss01" 1` are on everywhere (visible in the single-storey "a"). Antialiased font smoothing.
- Mono: JetBrains Mono Variable, then `ui-monospace, "SF Mono", "Cascadia Mono", "Noto Sans Mono", monospace`.
- All counts, fractions and versions use tabular numerals. The default body size is 13/20. No text below 11px.

| Size / line height | Weight | Where |
|---|---|---|
| 11/14 | 600, uppercase, letter spacing 0.04em, muted | Section eyebrows ("small caps" labels), popover titles |
| 11/14 | 600, letter spacing 0.02em | Logo tile initials |
| 11/14 | 600 | Two-letter monogram tiles |
| 11/14 | 500 | Badges, nav counts (muted), cell copy counts (muted), key hints |
| 11/14 | 400, muted | Column header second line |
| 12/16 | 500 | Column headers, disclosure triggers, micro buttons, filter labels, slim-band titles |
| 12/16 | 600 | Matrix section row title (count beside it is 12/16, 400, muted) |
| 12/16 | 400 | Status bar, subtitles, result counts, fractions, metadata, tooltips |
| 13/20 | 400 | Default: body copy, fact values, placeholder, select menu items |
| 13/20 | 500 | Row names, buttons, selects, segmented items, settings row titles, nav sub-items |
| 14/20 | 500 | Top-level nav items, large buttons |
| 14/20 | 600 | Logo wordmark, card titles, side-panel and detail-pane titles, sheet title |
| 16/24 | 600 | Page title in the header, empty-state title |
| 20/28 | 600 | Hero empty-state title |
| Mono 12/18 | 400 | Paths, short content IDs |

Long names and paths truncate in the middle, keeping the start and the distinguishing tail ("~/.claude/skills/000-…il-configuration"). Other single-line text truncates at the end with an ellipsis.

## Geometry

- Spacing steps: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48. Region padding 16 horizontally, 12 vertically. Section gap 24, label-to-body gap 8, fact row gap 4.
- Radii: 4 (badges, key hints, monogram tiles), 6 (micro buttons, menu items, segments, tooltips, logo tile, chips), 8 (buttons, inputs, selects, nav pills, notices), 12 (cards, popovers, sheet), full (skeleton dots).
- Control heights: 24 micro, 28 small, 32 default, 36 large.
- Row heights: table and list 36, section row 32, nav 32, nav sub-item 28. All rows carry a 1px bottom hairline.
- Icons: 16 default, 14 dense, 12 micro. Empty-state icon tile 36.

| Region | Size |
|---|---|
| Sidebar | 208 wide with a 1px right hairline |
| Icon rail | 56 wide |
| Header band | 48 tall including bottom hairline |
| Status bar | 28 tall including top hairline, spanning the full window width under the sidebar |
| Toolbar band | 36 tall plus 1px hairline |
| List column | 300 wide including hairline, minimum 260; detail fills the rest |
| Side panel | 352 below 1366 window width, 384 from 1366 to 1599, 480 from 1600; always full height from window top to status bar |
| Pane header (detail and side panel) | About 61 tall including hairline |

## Narrowing

Thresholds follow the window width in rem, so they also trigger under text zoom.

1. Without a side panel, the sidebar becomes the icon rail below 968 wide.
2. With a side panel docked, the sidebar becomes the rail once the content would fall below its minimum: 760 for the matrix, 720 for list-plus-detail. At 1280 this happens. At 1920 it does not.
3. If rail + panel + content minimum does not fit, the panel replaces the content entirely. A labelled back control (`arrow-left` plus the view name) appears, and the pane header tightens to 4 vertical padding.
4. List-plus-detail shows one pane at a time once its own width drops below 960. The detail header gains a muted breadcrumb: `arrow-left`, list name, "/", then icon and item name.
5. Toolbar: selects fold into one outline button labelled with `list-filter`, which opens a popover of labelled selects. The result count disappears below 640 of band width, and the find field may shrink to 80 and loses its key hint.
6. Status bar: right-hand and lower-priority items drop when the bar is under 960, then under 720. Remaining text ellipsizes. The most important item never shrinks.
7. Matrix: the header hides and rows stack below 640 or when the columns no longer fit. The first line is 28 tall with icon, name, row action and fraction. The second line is indented 40 and holds a chip for each harness where the item exists: 1px hairline, radius 6, 28 tall, muted 12px two-letter monogram, then the glyph. A muted 12px phrase after the chips counts the missing harnesses. Section rows shrink to 16 tall.
8. Harness card bodies are two columns at card width 704 and above, otherwise one. Fact rows stack below 288. Settings rows stack below 512.

The header keeps its text-labelled button at all widths observed. The smallest window in the screenshots is 960×640; smaller was seen only through text zoom.

## Resizing and space (core rule)

Nathan set this as a core UI value on 2026-11-09. Every page, panel and toolbar is judged against it.

1. **Nothing is ever cut off at any window size a person uses.** That means:
   - the minimum window (860×560);
   - laptop sizes (1280×800, 1440×900, 1512×982);
   - laptop full screen (1728×1117);
   - large displays up to 2560×1440, full screen.
   A clipped button, label, column or control is a **failure**, not polish.
2. **Space is used, not wasted.** Layout regions (tables, lists, cards, panels, toolbars, headers) grow with the
   window. There is no fixed-width inner container that makes the content look like a smaller window inside the app
   (a "hidden inner window" that doesn't expand when the app gets bigger). There is no large empty band beside content
   that could use it.
3. **Rows and columns fill the width sensibly.**
   - The flexible column (name and description) takes the free space.
   - Fixed columns (a tool's box) keep a steady width.
   - Nothing stretches oddly: no control floats far from what it belongs to, and no column is absurdly wide.
   - Where content can't usefully grow, it is placed on purpose (aligned, grouped). It never looks accidental.
4. **Only reading measure is capped.** Running prose (descriptions, READMEs, notes) may stop at about 70–80 characters
   per line. The region that holds it still spans the window, so a prose cap is not a layout cap.
5. **Adapt, don't clip.** As the window narrows:
   - things wrap, fold into one "More" menu, or go icon-only with tooltips, consistently within a toolbar;
   - two-pane views stack or collapse.
   Text truncates only with an ellipsis, with the full text available (a tooltip or a way to expand it).
6. **Full screen looks intentional.** Margins are balanced, headers and toolbars span the full width, and there are no
   odd gaps.
7. **Check every page at 860×560, 1280×800, 1728×1117 and 2560×1440,** in both appearances.

## Icons

Lucide only, stroke width 1.75 everywhere. Lucide renames icons between releases, so check each name against the installed version.

| Place | Lucide name |
|---|---|
| Nav: overview, library | `layout-grid`, `library` |
| Nav sub-items and matrix row icons: skills, agents, instructions, prompts, MCP servers | `wand-sparkles`, `bot`, `scroll-text`, `square-slash`, `server` |
| Nav: plugins and sources, harnesses, activity, settings | `puzzle`, `boxes`, `inbox`, `settings` |
| Header: sidebar toggle, shortcuts, refresh action | `panel-left`, `keyboard`, `refresh-cw` |
| Find field: magnifier, clear | `search`, `x` |
| Select: arrows, selected item tick | `chevrons-up-down`, `check` |
| Toolbar: select mode, legend, folded filters | `square`, `info`, `list-filter` |
| Checkbox off / on | `square` / `square-check` |
| Copy / copied | `copy` / `copy-check` |
| Disclosure closed / open | `chevron-right` / `chevron-down` |
| Back, close | `arrow-left`, `x` |
| Empty state: no results | `search-x` |
| Copies-differ badge | `diff` |
| Status bar | `eye` or `eye-off`, `check`, `lock`, `pause`, `wifi-off` |
| Notices | `info`, `triangle-alert`, `circle-alert`, `lock` |
| Other actions in the icon set, not all photographed | `package-plus`, `trash-2`, `undo-2`, `panel-right`, `folder-open`, `link-2`, `fingerprint`, `folder`, `store`, `git-branch`, `file-question-mark` |

Matrix cell glyphs, all 16px in a 28×28 slot:

| Look | Lucide name | Colour |
|---|---|---|
| Solid dot, about 9px visible: present | `circle-small`, filled | Primary text |
| Short dash: absent | `minus` | Muted (looks fainter because the stroke is thin) |
| Circle with slash: turned off | `circle-off` | Warning text |
| Circle with minus: partly off | `circle-minus` | Warning text |
| Circle with X: will not load | `circle-x` | Danger text |
| Document with "!": read problem | `file-warning` | Danger text |
| Stacked sheets: hidden by another copy | `layers` | Muted |
| Folder with X: unreachable | `folder-x` | Muted |
| Document with "?": not read yet | `file-question-mark` | Muted |
| Circle with "?": no evidence | `circle-question-mark` | Muted |

Other status glyphs available in the same system, not visible in these screenshots: `circle-check` (success), `circle-dashed` (muted), `slash` (faint), `octagon-alert` (danger), `triangle-alert` and `trash-2` (warning), `clock-3` and `circle-arrow-up` (accent), `rotate-cw` (info).

## App frame

Three columns over a full-width status bar: sidebar, then header above content, then the side panel when open. The page itself never scrolls; only named regions do. Dark sidebar and content share one colour and are separated only by the hairline. Light sidebar is off-white against white content.

**Sidebar.**
- Brand band: 48 tall with a bottom hairline, 16 left padding, gap 8. Logo tile 24×24, radius 6, accent fill, white "CK". Wordmark beside it.
- Nav list: 8 padding, 2 gap between rows. Top-level row 32 tall, radius 8, 8 padding, 8 gap, 16 icon, muted text.
- Hover: hover fill and primary text, 100ms. Current: current-nav fill, primary text, icon in accent text colour.
- Sub-rows: 28 tall, text 13px, icon 14, left padding 32, muted count right-aligned.
- Settings is pinned to the bottom, separated by empty space only.
- The list reserves a thin scrollbar gutter, so pills end about 189 while the bottom Settings pill runs to about 199.

**Icon rail.** Same structure, labels and counts hidden, logo tile and icons centred. Sub-items become ordinary icons in one column. Current item keeps the rounded pill and accent icon.

**Header.** 16 horizontal padding, 12 gap, panel fill. Left: ghost icon button 32×32 with `panel-left`, then page title (16/24, 600), truncating. Right, gap 8: ghost icon button with `keyboard`, then an outline button with `refresh-cw` and label. No breadcrumb in the header.

**Status bar.** Chrome fill, 12/16 muted text, 16 horizontal padding. Left group: icon-and-text items (14 glyph, 6 gap) spaced about 26 apart in the screenshots. Right group, right-aligned: app name muted with version in primary text, then a muted label. Danger items use danger text. This is the app's only place for ambient state: there are no toasts anywhere.

## Toolbar

Band directly under the header, 16 horizontal padding, bottom hairline, one line at all widths. Controls gap 8, 2 vertical padding. See [overview-dark](ui-reference/overview-dark.png).

- **Find field:** flexible, 192 to 352 wide, 32 tall, radius 8, control border, panel fill, small lift. `search` 16 muted at left, 6 gap, muted placeholder. Right side: a key-hint chip (20 tall, 6 padding, radius 4, hairline, 11px muted), replaced by a small `x` once text is entered. On focus the whole field shows the ring, not the inner input.
- **Filter select:** 32 tall, min 72, max 256, padding 12 left and 8 right, 6 gap, radius 8, control border, panel fill, small lift, 13/500 primary text, `chevrons-up-down` 14 muted. Hover: hover fill.
- **Select menu:** floating, radius 12, hairline, panel fill, overlay shadow, 4 padding, 2 gap. Items 32 tall, radius 6, 8 padding, a 14 tick column in accent text colour, 8 gap. Highlighted item takes hover fill.
- **Right end, pushed right:** result count (12px muted, tabular), 12 gap, a small primary button (28 tall), then with 4 gaps two 28×28 ghost icon buttons (`square`, `info`).
- **With items selected:** the selects give way to `square-check`, a count, a small primary button and a ghost clear button. The find field narrows to make room.

**Slim notice band** (optional, directly under the header): full width, 6 vertical and 16 horizontal padding, bottom hairline, neutral or tinted surface, 14 glyph, medium 12/16 title followed by muted 12/16 sentence. See the [dark review screenshot](ui-reference/review-panel-dark.png).

**Segmented control:** 2 padding and gap, radius 8, hover-fill background. Segments 28 tall, radius 6, 8 padding, 13/500 muted, 12px tabular count. Active segment: panel fill, small lift, primary text.

## Matrix table

See [overview-dark](ui-reference/overview-dark.png), [overview-light](ui-reference/overview-light.png), [overview-selected-row-dark](ui-reference/overview-selected-row-dark.png).

**Columns, left to right.** Name 192 to 512, then a 72 summary column, one 72 column per harness, a 104 column where one harness has two clients, then filler to the edge. The filler sits after the columns, so glyphs stay near the names on wide windows and the empty space collects at the right.

**Column header.** 36 tall, 1px bottom hairline, reserving the same scrollbar gutter as the body so columns stay aligned. First column label: muted, 12/16, 500, 16 left padding. Other columns: centred, primary text, 12/16, 500, 4 padding. Clickable headers show hover fill at radius 6. A column with two clients has a two-line header: name, then a muted 11/14 regular line with the two client names separated by " · ".

**Section row.** 32 tall plus hairline, chrome fill, 16 padding, 8 gap: bold 12px title, muted count, optional muted note prefixed with "· ". It stays pinned to the top of the scroll area while its rows pass under it.

**Item row.** 36 pitch with bottom hairline, no zebra.
- Name cell: 16 left and 8 right padding, 8 gap, muted 16 icon, then name at 13/20 500 in primary text.
- At the right end of the name column, in a cluster: a 14 checkbox glyph and a muted text-only ghost action at 12 to 13px. It renders at 50% opacity when unavailable.
- Summary cell: 12px muted tabular fraction, centred.
- Harness cells: one centred glyph. A copy count, when above one, sits 2 to the right in 11/14 muted tabular.
- Two-client column: two 28 slots, 8 apart.

**States.** No transition on row hover.
- Row hover: neutral hover fill across the row.
- Cell hover: the whole column, header included, also takes the hover fill, so a cell traces to its column.
- Selected: accent tint across the full row including filler, plus a 2px inset accent bar at the left edge. Selection is the only blue in the table.

**Loading.** Skeleton rows of the same geometry: a bar 60% wide and 16 tall inset 16 in the name cell, 16 circles in the harness columns, hairlines retained. A shimmer gradient moves hover fill → pressed fill → hover fill, 200% wide, over 2.4s linear.

## List and item detail

See [list-detail-dark](ui-reference/list-detail-dark.png), [list-detail-light](ui-reference/list-detail-light.png).

**List column.** Right hairline. On top, a toolbar band with a find field and one 28 ghost icon button. Rows: 36 plus hairline (37 pitch), 12 left and 8 right padding, 8 gap: 16 muted icon, 13/20 500 name truncating in the middle, optional badge, 12px fraction, 28 status slot, then the checkbox-and-action cluster.

Hover: neutral fill. Selected: accent tint and 2px inset accent bar at the left. In the screenshots the tint stops before the checkbox-and-action cluster, leaving that part unfilled.

**Badge.** 20 tall, 6 padding, radius 4, 11/14 500, surface and text in the same role (info for copies-differ), 12 icon. In a narrow list only the icon remains, with 4 padding.

**Detail pane.** Fills the remainder. Pane header: 12 vertical and 16 horizontal padding, bottom hairline, 8 gap: 16 muted icon, then 14/20 600 name over 12/16 muted subtitle. Body scrolls with stacked sections, never tabs: 16 side padding, 12 top, 24 between sections. Each section starts with an uppercase eyebrow, then 8 gap, then body copy in 13/20. A secondary line of the same size is muted.

**Fact list.** Two columns, term width 96 to 144 then 12 gap. Terms muted, values primary text, baseline aligned, 4 row gap (24 pitch with 20 line height). The compact variant uses mono 12 for short terms and a content-sized term column with 8 gap.

**Path card.** Card radius 12, hairline, panel fill, small lift. Compact padding:
- Top line (6 top, 8 right, 2 bottom, 12 left): mono 12/18 path in primary text. At far right, a 24×24 ghost icon button with a 14 `copy` glyph, which becomes `copy-check` after copying.
- Second line (12 side padding): mono short ID in a roughly 60 wide column, then wrapping tags, each a 16 glyph plus 13/20 name.
- Last line: disclosure trigger (24 tall, radius 6, 4 left and 8 right padding, 4 gap, 14 chevron, 12/16 500 muted; hover fill with primary text).
- Several cards stack with an 8 gap.

## Harness cards

See [harness-cards-dark](ui-reference/harness-cards-dark.png), [harness-cards-light](ui-reference/harness-cards-light.png).

A single scrolling column of full-width cards: 16 side margin, 12 from the top, 16 between cards. Card: radius 12, hairline, panel fill, small lift.

- **Header:** 12 vertical and 16 horizontal padding, bottom hairline, 12 gap. A monogram tile (20×20, radius 4, hairline, 11/600, plain text, no brand colour), then 14/20 600 title with 8 gap, then muted mono 12/18 path truncating in the middle. Far right: 24×24 ghost `copy`.
- **Body:** 16 padding, two equal columns with 24 column gap and 16 row gap, top aligned. Each column stacks eyebrow sections with fact lists and muted secondary lines.
- **Link text:** accent text colour, micro-button size (12/16 500), 8 padding, underline on hover.
- Harnesses have no logo colours anywhere: monogram tiles and plain text only.

## Review side panel

See [review-panel-dark](ui-reference/review-panel-dark.png), [review-panel-light](ui-reference/review-panel-light.png).

The panel takes layout space and never covers content. It occupies the right column from the top of the window to the status bar, beside the header rather than under it, with a 1px left hairline and panel fill. Header, scrolling body, footer.

- **Header:** like a pane header. 14/20 600 title over 12/16 muted subtitle. Right: 28×28 ghost `x` close button.
- **Body:** scrolls, 12 vertical and 16 horizontal padding, classic scrollbar on the right. Opening lines are primary text 13/20, then one or two muted lines. A disclosure trigger may follow. Eyebrow sections group the content.
- **Change cards:** radius 12, hairline, about 8 vertical and 12 horizontal padding, 4 line gap, 8 between cards. Inside: name at 13/20 500 with a muted version beside it or below, client names in 12 to 13px, paths in mono 12/18, muted closing note. Names and sentences wrap; paths truncate in the middle.
- **Footer:** top hairline, 12 vertical and 16 horizontal padding, about 81 tall in total. A one-line 12px primary-text message, then 4 gap, then a row with the ghost cancel button at far left and the 32 tall primary button at far right.
- **Preparing state:** plain 13/20 text alone in the body, a progress phrase in the footer message, and the primary button at 50% opacity.
- In the light screenshot the toolbar's primary button renders with the neutral secondary fill while the panel is open, leaving the footer button as the only blue action. In the dark item-panel screenshot it stays blue. The matrix stays fully visible and scrolls independently.

## Buttons and controls

All buttons: 13/20 500, 8 radius, 6 icon gap, 1px border (transparent unless noted), no-wrap, default cursor, no text selection. Icon-only buttons are square at their height.

| Size | Height | Padding | Text | Icon |
|---|---|---|---|---|
| Micro | 24 | 8 | 12/16, radius 6 | 14 |
| Small | 28 | 8 | 13/20 | 14 |
| Default | 32 | 12 | 13/20 | 16 |
| Large | 36 | 16 | 14/20 | 16 |

| Variant | Rest | Hover |
|---|---|---|
| Primary | Accent fill, white text, small lift, top highlight | Accent hover fill |
| Secondary | Hover fill, primary text | Pressed fill |
| Outline | Control border, panel fill, primary text, small lift, top highlight | Pressed fill |
| Ghost | Transparent, muted text | Pressed fill, primary text |
| Destructive | `#dc2626` fill, white text | Not specified; assume unchanged |
| Destructive outline | Control border, panel fill, danger text | Danger surface fill |
| Link | Accent text | Underline |

Press: scale 0.97. Disabled: 50% opacity with no hover change.

**Checkboxes** are outline lucide glyphs, not filled boxes: `square` and `square-check`, about 14px, muted. They carry no accent fill when checked.

**Text field:** optional 500-weight label, 4 gap, input min 32 tall, 4 vertical and 8 horizontal padding, control border, radius 8, panel fill.

**Settings row:** title (500) and muted 12/16 description at left, control at far right, 12 vertical padding, bottom hairline, 24 column gap.

**Notice card:** 12 padding, radius 8, hairline, neutral or tinted fill, 16 glyph in the role's text colour, 13/20 600 title, body, actions below with 8 gap.

## Empty and loading states

See [empty-filter-dark](ui-reference/empty-filter-dark.png), [empty-state-light](ui-reference/empty-state-light.png).

Centred in the region, 32 vertical and 16 horizontal padding, 8 gap. A 36×36 tile (radius 8, hairline, panel fill, small lift) with a 16 muted glyph and 8 extra below it. Then title at 16/24 600 (hero size 20/28), max width 384. Then a muted 13/20 body, max width 384. Then an outline button with 8 extra above. A compact variant uses 16 vertical padding. Toolbar and column layout remain around the state where they apply; the column header disappears when no rows match.

Continuous animation exists only for the skeleton shimmer (2.4s linear) and a stepped progress pulse. Long work uses named step text rather than a spinner.

## Overlays

Only these float. Each stays inside the viewport.

- **Popover:** radius 12, hairline, panel fill, overlay shadow, top highlight, 12 padding, 8 gap, width 192 to 384. Optional eyebrow title. See [key-popover-dark](ui-reference/key-popover-dark.png), where a glyph-and-word list sits at 13/20 with about 26 pitch.
- **Tooltip:** radius 6, hairline, panel fill, overlay shadow, 4 vertical and 8 horizontal padding, 12/16 text, max 320. May include a small key hint with 4 padding, radius 4, hairline, 11/14 500 muted.
- **Modal sheet:** centred horizontally, 15% from the top of the viewport, 640 wide (window minus 32 if narrower), max 70% of the height, radius 12. Header 12 vertical and 16 horizontal padding, bottom hairline, 14/20 600 title, 28 ghost `x`.

## Scrollbars

No custom styling: classic native Chromium scrollbars following the light or dark colour scheme, including arrow buttons. The screenshots show a 15 wide track with a 9 wide rounded thumb. Sampled: dark track `#2c2c2c` and thumb `#9f9f9f`; light track `#fcfcfc` and thumb `#8b8b8b`. Scroll regions always reserve the gutter so content never shifts, and the sidebar uses the thin variant. On systems with overlay scrollbars, content keeps the last 16 clear while row backgrounds and hairlines still reach the edge.

## Interaction feel

- **Hover:** a neutral fill, never a colour or shadow change. Blue means selected, focused or primary.
- **Focus:** keyboard focus shows a 2px solid ring inset by 2px, so scroll regions cannot clip it. Primary and destructive buttons draw it in white on their own fill.
- **Motion:** buttons and nav transition fill, border, text colour and scale over 100ms `cubic-bezier(0.22, 1, 0.36, 1)`. Popovers and select menus fade and scale from 0.98 over 120ms with the same curve; tooltips likewise over 100ms; the sheet and its backdrop over 120ms. Rows change instantly. Reduced-motion turns all of it off and sets press scale to 1.
- **Cursor:** the default arrow everywhere, including buttons, giving a desktop-app rather than web feel.
- **Layout:** panels and panes take real space; the matrix reflows beside a panel rather than being covered. Fixed-size glyph slots mean a status change never shifts a row.
- **Feedback:** results appear in place in panels and the status bar. There are no toasts.

## Uncertain

- **Side-panel motion:** the old design notes describe 160ms `cubic-bezier(0.32, 0.72, 0, 1)` with content sliding 8px and fading while the layout snaps in one step, but no style applies it and still images cannot show it. Treat as intent. The panel may simply have appeared.
- **Not photographed, taken from style values only:** open select menus, tooltips, the modal sheet, focus rings, hover states, skeleton rows, destructive buttons, and tinted notice bands.
- **Status-bar spacing:** values say 16 padding and 16 gap, but screenshots show the first glyph at about x=25 and items about 26 apart. Follow the screenshots.
- **Row action cluster:** the checkbox hit area (24 or 28) and action text size (12 or 13px) could not be confirmed. The checkbox glyph measures about 12px visible, consistent with a 14 icon, while the toolbar `info` glyph measures closer to a 16 icon despite sitting in a 28 button.
- **List-row tint stopping short of the action cluster** looks accidental rather than designed. It is reported as seen.
- **Scrollbar geometry** comes from Linux Chromium screenshots and will differ by OS. The sidebar's thin scrollbar never appeared at normal text size at 1280.
- **Hex approximations** for oklch colours and tinted surfaces are conversions. The accent, selected tint and info surface matched sampled pixels; the other tinted surfaces are computed.
