# Music Player UI/UX Pro Max Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the music player web application into an Apple Music / Spotify level modern dark glassmorphism experience on Desktop and an iOS/Android native app feel on Mobile, adhering strictly to `ui-ux-pro-max` design guidelines while preserving 100% of audio playback, GDStudio primary API failover, FLAC lossless streaming, and lyrics features.

**Architecture:** 
1. Establish a 3-layer design token architecture in `css/style.css` (primitives, semantic glassmorphism tokens, component variables) with support for OLED dark mode and clean light mode.
2. Structure Desktop with an immersive backdrop-filter blurred sidebar, floating glass player bar with breathing glow and real-time Hi-Res FLAC quality switcher, and bento-grid charts.
3. Structure Mobile ($\le 860\text{px}$) as a native app shell: fixed top search/branding bar, floating bottom tab navigation bar (`env(safe-area-inset-bottom)`), persistent mini-player bar with live progress, and a tap-to-expand full-screen playback drawer.
4. Enhance `js/app.js` to coordinate mobile tab switches, mini-player open/expand triggers, and seamless search focus without layout shifts.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5 Audio / Web Audio API, Modern CSS (CSS Grid, Flexbox, CSS Custom Properties, `backdrop-filter: blur()`, `@supports`).

**Spec:** Redesign music player web and mobile viewports following `ui-ux-pro-max` design system, responsive touch standards ($\ge 44\text{px}$), and dark glassmorphism guidelines.

## Global Constraints

- Audio streaming API priority order must remain: `#1 https://music-api.gdstudio.xyz/api.php`, `#2 https://music.gdstudio.xyz/api.php`, then Meting/Qijieya failovers.
- Real-time FLAC / Hi-Res / 320k / 128k audio quality switcher must remain reactive and functional.
- Touch target sizes for all interactive elements on mobile must be $\ge 44 \times 44\text{px}$ with $\ge 8\text{px}$ spacing.
- Visual theme uses Apple Music dark glassmorphism: background `#0a0b14`, frosted glass surfaces `rgba(20, 20, 38, 0.75)`, blur `24px`, emerald accent `#10b981`, and golden Hi-Res `#f59e0b`.
- No third-party heavy frameworks (no React/Vue rebuild); zero disruption to GitHub Pages static deployment.

## Review Focus

1. Mobile viewport ($\le 860\text{px}$): Sidebar desktop elements do not stack or clutter the top of the screen; mobile tab navigation and mini-player stay anchored to the bottom.
2. Search popover: Collapsed by default; expands smoothly on focus/click without breaking page layout or overlapping critical controls.
3. Audio playback continuity: Tapping mobile mini-player or switching views does not pause, restart, or stutter audio.
4. High DPI / Notch screens: Bottom navigation honors `padding-bottom: env(safe-area-inset-bottom)` on iOS Safari and mobile Chrome.
5. Desktop viewports ($> 860\text{px}$): Floating bottom player bar, lyrics panel, and bento cards maintain proper z-index, spacing, and contrast $\ge 4.5:1$.

---

### Task 1: Design Tokens & Glassmorphism Theme Architecture

**Files:**
- Modify: `music-player/css/style.css:1-120`

**Interfaces:**
- Consumes: Existing color variables (`--bg`, `--panel`, `--card`, `--accent`, etc.)
- Produces: Enhanced CSS variables including `--glass-bg`, `--glass-border`, `--glass-blur`, `--card-glow`, `--accent-glow`, `--gold-hires`, and safe-area variables.

- [ ] **Step 1: Define comprehensive design tokens and glassmorphism properties**
Update `:root` and `body.light` in `music-player/css/style.css` with:
- Dark mode OLED background: `#090a12`
- Frosted glass panels: `rgba(18, 19, 36, 0.72)` with `backdrop-filter: blur(24px) saturate(180%)`
- Elevated cards: `rgba(28, 29, 52, 0.65)` with border `1px solid rgba(255, 255, 255, 0.08)`
- Glow shadows: `0 8px 32px 0 rgba(0, 0, 0, 0.37)`
- Accent emerald `#10b981` and Hi-Res Gold `#f59e0b`
- iOS safe-area variables: `--sab: env(safe-area-inset-bottom, 0px)`

- [ ] **Step 2: Add universal smooth transition and typography rules**
Add refined typography `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, "PingFang SC"` with `-webkit-font-smoothing: antialiased` and smooth theme transitions.

- [ ] **Step 3: Verify CSS syntax and variable resolution**
Inspect `music-player/css/style.css` for clean syntax and no missing closing braces.

- [ ] **Step 4: Commit**
```bash
git add music-player/css/style.css
git commit -m "style: establish ui-ux-pro-max glassmorphism design tokens"
```

---

### Task 2: Desktop Layout & Bento Grid Refinement

**Files:**
- Modify: `music-player/index.html:25-122`
- Modify: `music-player/css/style.css:121-500`

**Interfaces:**
- Consumes: Design tokens from Task 1
- Produces: Modernized desktop sidebar, glass cards, bento charts grid, and floating player bar.

- [ ] **Step 1: Refactor desktop sidebar and navigation elements in `style.css`**
- Apply glassmorphism styling to `.side-card` with subtle gradient border and inner glow.
- Style logo with gradient brand badge and animated music bar indicator.
- Refine `.side-nav button` with pill indicators on hover/active (`border-left: 3px solid var(--accent)`).

- [ ] **Step 2: Upgrade Bento Grid cards for Playlists & Official Charts**
- Enhance `.chart-grid` with auto-fill bento layout (`repeat(auto-fill, minmax(180px, 1fr))`).
- Add glass sheen hover effect (`transform: translateY(-4px)`, shadow glow, and cover image zoom).
- Format playlist tags and track counts with clean rounded micro-chips.

- [ ] **Step 3: Refine Desktop Bottom Player Bar (`#player-bar`)**
- Floating pill/glass dock style with `backdrop-filter: blur(28px)` and subtle top border highlight.
- Add pulsating breathing glow for album cover when playing.
- Center scrubber with smooth progress fill and hover preview tooltip.
- Right controls: EQ, PiP lyrics button, queue badge, live real-time quality switcher badge, and sleek volume bar.

- [ ] **Step 4: Test and commit**
```bash
git add music-player/index.html music-player/css/style.css
git commit -m "feat(desktop): modernize sidebar, bento cards, and floating player bar"
```

---

### Task 3: Mobile Native App Shell, Bottom Nav & Mini-Player Drawer

**Files:**
- Modify: `music-player/index.html:290-305`
- Modify: `music-player/css/style.css:950-1035`
- Modify: `music-player/js/app.js:1500-1650`

**Interfaces:**
- Consumes: Mobile markup and player state in `music-player/js/app.js`
- Produces: Mobile app shell with top header, fixed bottom navigation bar, floating mini-player bar, and tap-to-expand now-playing drawer.

- [ ] **Step 1: Structure Mobile Header & Tab Navigation in `index.html`**
- Ensure top mobile bar contains logo, search trigger icon, and settings shortcut.
- Enhance `#mobile-nav` with 5 clear touch-friendly tabs:
  1. 首页 (Home)
  2. 搜索 (Search)
  3. 媒体库 (Library: 自建歌单与收藏)
  4. 播放队列 (Queue with live count badge)
  5. 更多 (More: 音效/定时/设置)

- [ ] **Step 2: Implement Mobile Mini-Player Floating Bar in `style.css`**
- Position mini-player directly above bottom nav: `bottom: calc(56px + var(--sab))`.
- Glassmorphism background, compact 52px height, slim 2px real-time progress bar along top edge.
- Touch layout: Album thumbnail ($40\times 40\text{px}$), title & artist with overflow ellipsis, quick play/pause button ($\ge 44\times 44\text{px}$ touch target), and next track button.
- Tap anywhere on the mini-player body triggers the expansion of `#now-playing` full-screen drawer.

- [ ] **Step 3: Wire Mobile Tab Switching & Mini-Player Handlers in `js/app.js`**
- Add event listeners for `#mobile-nav` tabs:
  - "首页": Shows `#view-home`
  - "搜索": Activates search box, shows input, focuses search field
  - "媒体库": Switches to custom playlists & favorites view
  - "队列": Toggles `#queue-drawer`
  - "更多": Opens bottom action sheet or settings modal
- Ensure tapping `#pb-open` or `#player-bar` on mobile opens the `#now-playing` full-screen modal smoothly.

- [ ] **Step 4: Verify mobile layout responsiveness at 375px and 414px width**
Check that sidebar does NOT stack above main content on mobile; mobile nav is sticky at bottom.

- [ ] **Step 5: Commit**
```bash
git add music-player/index.html music-player/css/style.css music-player/js/app.js
git commit -m "feat(mobile): implement native app shell, bottom nav, and floating mini-player"
```

---

### Task 4: Search Popover, Modals & Touch Target Accessibility Optimization

**Files:**
- Modify: `music-player/index.html:30-65, 300-450`
- Modify: `music-player/css/style.css:400-550, 750-940`
- Modify: `music-player/js/app.js:200-280`

**Interfaces:**
- Consumes: Search input, history tags, and modals
- Produces: Polished glass search popover, accessible $\ge 44\text{px}$ touch targets, and sleek modal sheets.

- [ ] **Step 1: Refine Search Popover Behavior and Styling**
- Style `#search-tags-box` with floating glass card, smooth fade-in/scale animation.
- Keep search history and hot recommendation tags as sleek rounded pills with clear hover/tap states.
- Ensure clicking outside or executing search closes the popover neatly.

- [ ] **Step 2: Optimize Modal Dialogs (EQ, Settings, Sleep Timer, Playlist)**
- On desktop: Centered frosted glass modal with subtle backdrop dim.
- On mobile: Slide-up bottom sheet with grab handle, rounded top corners (`border-radius: 20px 20px 0 0`), and safe-area padding.
- Ensure all close buttons and action buttons have $\ge 44\times 44\text{px}$ hit areas.

- [ ] **Step 3: Test and commit**
```bash
git add music-player/index.html music-player/css/style.css music-player/js/app.js
git commit -m "feat(ux): polish search popover, bottom sheet modals, and touch targets"
```

---

### Task 5: End-to-End Responsive Verification & Git Deployment

**Files:**
- Verify: `music-player/index.html`
- Verify: `music-player/css/style.css`
- Verify: `music-player/js/app.js`

**Interfaces:**
- Consumes: All modified files
- Produces: Verified responsive design on Desktop and Mobile, with commit pushed to GitHub `main` for automatic GitHub Pages deployment.

- [ ] **Step 1: Verify Desktop viewport (1440px)**
- Check sidebar, search popover, bento grids, audio playback, Hi-Res FLAC quality badge, and lyrics panel.
- Verify volume slider, EQ toggle, and PiP lyrics work as expected.

- [ ] **Step 2: Verify Mobile viewport (375px/390px/768px)**
- Check mobile top bar, bottom tab bar, floating mini player, and full-screen drawer.
- Verify touch targets $\ge 44\text{px}$ and smooth tab transitions.

- [ ] **Step 3: Verify Failover Chain & GDStudio API #1**
- Confirm `https://music-api.gdstudio.xyz/api.php` is contacted first, with failover working.

- [ ] **Step 4: Push to Git and GitHub Pages**
```bash
git push origin main
```
Confirm deployment status on GitHub Pages.
