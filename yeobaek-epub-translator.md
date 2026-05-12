
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>여백 | EPUB 번역 워크벤치</title>
  <style>
    :root {
      --bg: oklch(97% 0.018 70);
      --surface: oklch(99% 0.008 70);
      --fg: oklch(22% 0.02 50);
      --muted: oklch(50% 0.018 50);
      --border: oklch(90% 0.014 70);
      --accent: oklch(64% 0.13 28);
      --font-display: 'Tiempos Headline', 'Newsreader', 'Iowan Old Style', Georgia, serif;
      --font-body: 'Sohne', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-mono: 'PT Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
      --radius-lg: 24px;
      --radius-md: 16px;
      --radius-sm: 12px;
      --shadow-soft: 0 18px 60px color-mix(in oklab, var(--fg) 8%, transparent);
      --pad-1: 4px;
      --pad-2: 8px;
      --pad-3: 12px;
      --pad-4: 16px;
      --pad-5: 24px;
      --pad-6: 32px;
      --pad-7: 40px;
      --sidebar-w: 252px;
      --toolbar-h: 82px;
      --workbench-left: 1fr;
      --workbench-right: 1fr;
      --paper-opacity: 1;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font-body);
    }

    body {
      background-image:
        linear-gradient(180deg, color-mix(in oklab, var(--surface) 88%, transparent), transparent 40%),
        radial-gradient(circle at top left, color-mix(in oklab, var(--accent) 9%, var(--bg)) 0, transparent 34%),
        radial-gradient(circle at bottom right, color-mix(in oklab, var(--fg) 3%, transparent) 0, transparent 36%);
      letter-spacing: 0;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: calc(0.18 * var(--paper-opacity));
      background-image:
        linear-gradient(0deg, transparent 24%, color-mix(in oklab, var(--fg) 6%, transparent) 25%, transparent 26%),
        linear-gradient(90deg, transparent 24%, color-mix(in oklab, var(--fg) 4%, transparent) 25%, transparent 26%);
      background-size: 16px 16px;
      mix-blend-mode: multiply;
    }

    body[data-density="compact"] {
      --pad-4: 14px;
      --pad-5: 20px;
      --pad-6: 26px;
      --pad-7: 32px;
      --sidebar-w: 228px;
    }

    body[data-layout="source"] {
      --workbench-left: 1.18fr;
      --workbench-right: 0.92fr;
    }

    body[data-layout="translation"] {
      --workbench-left: 0.92fr;
      --workbench-right: 1.18fr;
    }

    body[data-accent="moss"] {
      --accent: oklch(64% 0.11 145);
    }

    body[data-accent="ink"] {
      --accent: oklch(42% 0.04 255);
    }

    body[data-paper="off"] {
      --paper-opacity: 0;
    }

    button, input, select {
      font: inherit;
    }

    .app {
      width: min(1480px, calc(100vw - 40px));
      min-height: calc(100vh - 40px);
      margin: 20px auto;
      display: grid;
      grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
      background: color-mix(in oklab, var(--surface) 94%, white);
      border: 1px solid var(--border);
      border-radius: 28px;
      overflow: hidden;
      box-shadow: var(--shadow-soft);
      position: relative;
    }

    .sidebar {
      padding: var(--pad-5);
      border-inline-end: 1px solid var(--border);
      background:
        linear-gradient(180deg, color-mix(in oklab, var(--surface) 94%, white), color-mix(in oklab, var(--bg) 72%, white));
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: var(--pad-5);
    }

    .brand {
      display: grid;
      gap: 10px;
    }

    .mark {
      inline-size: 42px;
      block-size: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: color-mix(in oklab, var(--accent) 18%, var(--surface));
      font-family: var(--font-display);
      font-size: 24px;
      color: var(--fg);
    }

    .brand h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 32px;
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .brand p,
    .small-note,
    .chip,
    .meta,
    .muted {
      color: var(--muted);
    }

    .brand p {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
    }

    .nav {
      display: grid;
      gap: 8px;
    }

    .nav button {
      border: 1px solid transparent;
      background: transparent;
      color: var(--fg);
      text-align: start;
      padding: 12px 14px;
      border-radius: 14px;
      display: grid;
      gap: 4px;
      cursor: pointer;
      transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
    }

    .nav button:hover,
    .nav button:focus-visible {
      background: color-mix(in oklab, var(--accent) 6%, var(--surface));
      border-color: color-mix(in oklab, var(--accent) 14%, var(--border));
      outline: none;
    }

    .nav button.is-active {
      background: color-mix(in oklab, var(--accent) 11%, var(--surface));
      border-color: color-mix(in oklab, var(--accent) 30%, var(--border));
      transform: translateX(2px);
    }

    .nav strong,
    .eyebrow,
    .toolbar-label,
    .panel-label,
    .mini-label,
    .tweaks h2 {
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .nav strong {
      font-size: 12px;
      font-weight: 600;
    }

    .nav span {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.45;
    }

    .side-card,
    .panel,
    .tile,
    .book,
    .metric,
    .chapter-card,
    .glossary-row,
    .checklist li,
    .tweaks {
      background: color-mix(in oklab, var(--surface) 96%, white);
      border: 1px solid var(--border);
    }

    .side-card {
      border-radius: 18px;
      padding: var(--pad-4);
      display: grid;
      gap: 10px;
    }

    .eyebrow,
    .toolbar-label,
    .panel-label,
    .mini-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
    }

    .side-card h2,
    .section-title,
    .screen-head h2,
    .workbench-title {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 600;
      letter-spacing: -0.025em;
      text-wrap: pretty;
    }

    .side-card h2 {
      font-size: 24px;
      line-height: 1.15;
    }

    .track-list {
      display: grid;
      gap: 10px;
    }

    .track-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 14px;
      color: var(--fg);
    }

    .track-item span:last-child {
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .topbar {
      min-height: var(--toolbar-h);
      padding: 20px 26px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      background: color-mix(in oklab, var(--surface) 92%, white);
      position: sticky;
      top: 0;
      z-index: 5;
      backdrop-filter: blur(12px);
    }

    .crumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      color: var(--muted);
      font-size: 14px;
    }

    .crumbs strong {
      color: var(--fg);
      font-weight: 600;
    }

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: end;
    }

    .pill,
    .ghost,
    .primary {
      border-radius: 999px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      cursor: pointer;
      letter-spacing: 0.02em;
      font-size: 13px;
    }

    .pill {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
      cursor: default;
    }

    .primary {
      background: var(--fg);
      color: var(--surface);
      border-color: var(--fg);
    }

    .ghost:hover,
    .primary:hover,
    .ghost:focus-visible,
    .primary:focus-visible {
      outline: none;
      transform: translateY(-1px);
    }

    .workspace {
      min-width: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .screens {
      min-width: 0;
      min-height: 0;
      position: relative;
    }

    .screen {
      display: none;
      min-height: calc(100vh - 122px);
      padding: 30px;
      overflow: auto;
      gap: var(--pad-5);
    }

    .screen.is-active {
      display: grid;
      align-content: start;
      animation: fadeUp 260ms ease;
    }

    @keyframes fadeUp {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .screen-head {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
      flex-wrap: wrap;
    }

    .screen-head h2 {
      font-size: clamp(40px, 4.2vw, 56px);
      line-height: 1.02;
      max-width: 12ch;
    }

    .screen-head p {
      margin: 0;
      max-width: 56ch;
      font-size: 16px;
      line-height: 1.6;
      color: var(--muted);
    }

    .head-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .hero-grid,
    .series-grid,
    .export-grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: var(--pad-5);
    }

    .panel,
    .tile,
    .metric,
    .chapter-card,
    .book {
      border-radius: var(--radius-lg);
    }

    .panel {
      padding: var(--pad-5);
      display: grid;
      gap: var(--pad-4);
    }

    .span-7 { grid-column: span 7; }
    .span-5 { grid-column: span 5; }
    .span-4 { grid-column: span 4; }
    .span-3 { grid-column: span 3; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }

    .hero-feature {
      display: grid;
      gap: var(--pad-5);
      background:
        linear-gradient(135deg, color-mix(in oklab, var(--surface) 84%, white), color-mix(in oklab, var(--accent) 8%, var(--surface)));
    }

    .hero-topline {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .hero-feature p {
      margin: 0;
      font-size: 17px;
      line-height: 1.65;
      max-width: 58ch;
      color: color-mix(in oklab, var(--fg) 84%, var(--muted));
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .metric {
      padding: 18px;
      display: grid;
      gap: 8px;
      background: color-mix(in oklab, var(--surface) 92%, white);
    }

    .metric strong {
      font-family: var(--font-display);
      font-size: 32px;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .metric span {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.45;
    }

    .book-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .book {
      padding: 18px;
      display: grid;
      gap: 14px;
    }

    .cover {
      aspect-ratio: 4 / 5;
      border-radius: 14px;
      background:
        linear-gradient(160deg, color-mix(in oklab, var(--surface) 82%, white), color-mix(in oklab, var(--fg) 8%, var(--surface)));
      position: relative;
      overflow: hidden;
    }

    .cover::after {
      content: "";
      position: absolute;
      inset: 18px;
      border: 1px solid color-mix(in oklab, var(--surface) 55%, var(--fg));
      border-radius: 10px;
    }

    .cover-label {
      position: absolute;
      inset-inline-start: 18px;
      inset-block-end: 18px;
      font-family: var(--font-display);
      font-size: 24px;
      letter-spacing: -0.02em;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .progress {
      block-size: 8px;
      border-radius: 999px;
      background: color-mix(in oklab, var(--fg) 8%, var(--surface));
      overflow: hidden;
    }

    .progress > span {
      display: block;
      block-size: 100%;
      border-radius: inherit;
      background: color-mix(in oklab, var(--fg) 68%, var(--surface));
    }

    .timeline {
      display: grid;
      gap: 12px;
    }

    .timeline .row {
      align-items: start;
      padding-block-end: 12px;
      border-bottom: 1px dashed var(--border);
    }

    .timeline .row:last-child {
      border-bottom: 0;
      padding-block-end: 0;
    }

    .timeline strong {
      font-size: 15px;
    }

    .timeline p {
      margin: 4px 0 0;
      font-size: 14px;
      color: var(--muted);
      line-height: 1.55;
      max-width: 48ch;
    }

    .series-banner {
      background:
        radial-gradient(circle at top right, color-mix(in oklab, var(--accent) 12%, var(--surface)), transparent 38%),
        linear-gradient(180deg, color-mix(in oklab, var(--surface) 94%, white), color-mix(in oklab, var(--bg) 80%, white));
    }

    .series-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .chip {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      background: color-mix(in oklab, var(--surface) 94%, white);
    }

    .chapter-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .chapter-card {
      padding: 18px;
      display: grid;
      gap: 12px;
      background: color-mix(in oklab, var(--surface) 94%, white);
    }

    .chapter-card h3,
    .panel h3,
    .book h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: -0.015em;
      text-wrap: pretty;
    }

    .chapter-card p,
    .panel p,
    .book p,
    .tile p {
      margin: 0;
      font-size: 14px;
      line-height: 1.6;
      color: var(--muted);
    }

    .workbench {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: var(--pad-5);
      min-width: 0;
    }

    body[data-focus="true"] .workbench {
      grid-template-columns: minmax(0, 1fr);
    }

    body[data-focus="true"] .auxiliary {
      display: none;
    }

    .editor-shell {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .workbench-header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: start;
      flex-wrap: wrap;
    }

    .workbench-title {
      font-size: clamp(32px, 3.4vw, 44px);
      line-height: 1.04;
      max-width: 12ch;
    }

    .workbench-sub {
      margin: 0;
      max-width: 52ch;
      font-size: 15px;
      line-height: 1.6;
      color: var(--muted);
    }

    .editor-toolbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid var(--border);
      background: color-mix(in oklab, var(--surface) 95%, white);
    }

    .editor-toolbar .row {
      gap: 10px;
    }

    .editor-panes {
      display: grid;
      grid-template-columns: minmax(0, var(--workbench-left)) minmax(0, var(--workbench-right));
      gap: 14px;
      min-height: 560px;
    }

    .pane {
      min-width: 0;
      border-radius: 22px;
      border: 1px solid var(--border);
      background: color-mix(in oklab, var(--surface) 95%, white);
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
    }

    .pane-head {
      padding: 16px 18px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      border-bottom: 1px solid var(--border);
      background: color-mix(in oklab, var(--surface) 90%, white);
    }

    .pane-head strong {
      font-size: 16px;
      letter-spacing: -0.01em;
    }

    .pane-body {
      padding: 20px 22px 24px;
      display: grid;
      gap: 18px;
      align-content: start;
      overflow: auto;
    }

    .passage {
      display: grid;
      gap: 10px;
      padding-bottom: 18px;
      border-bottom: 1px dashed var(--border);
    }

    .passage:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .passage .meta {
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .source {
      font-family: 'Georgia', var(--font-display);
      font-size: 20px;
      line-height: 1.6;
      letter-spacing: -0.01em;
      max-width: 34ch;
      color: color-mix(in oklab, var(--fg) 92%, black);
    }

    .translation {
      font-size: 18px;
      line-height: 1.7;
      max-width: 34ch;
      color: color-mix(in oklab, var(--fg) 96%, black);
    }

    .note {
      padding-inline-start: 14px;
      border-inline-start: 3px solid color-mix(in oklab, var(--accent) 56%, var(--surface));
      font-size: 14px;
      line-height: 1.55;
      color: var(--muted);
      max-width: 42ch;
    }

    .auxiliary {
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .tile {
      padding: 18px;
      display: grid;
      gap: 14px;
      border-radius: 20px;
    }

    .tile h3 {
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
      letter-spacing: -0.015em;
    }

    .glossary-list,
    .checklist {
      display: grid;
      gap: 10px;
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .glossary-list li,
    .checklist li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
      padding: 12px 14px;
      border-radius: 14px;
    }

    .glossary-list strong,
    .checklist strong {
      display: block;
      font-size: 14px;
    }

    .glossary-list span,
    .checklist span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .mini-stack {
      display: grid;
      gap: 8px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .stats .tile {
      padding: 14px;
      gap: 8px;
      border-radius: 16px;
    }

    .stats strong {
      font-family: var(--font-display);
      font-size: 28px;
      line-height: 1;
      letter-spacing: -0.03em;
    }

    .glossary-board {
      display: grid;
      gap: 12px;
    }

    .glossary-row {
      border-radius: 18px;
      padding: 16px 18px;
      display: grid;
      grid-template-columns: 1.1fr 1fr 1.2fr 0.8fr;
      gap: 18px;
      align-items: start;
    }

    .glossary-row strong {
      display: block;
      margin-bottom: 6px;
      font-size: 15px;
    }

    .glossary-row span {
      display: block;
      font-size: 13px;
      line-height: 1.5;
      color: var(--muted);
    }

    .issue {
      color: color-mix(in oklab, var(--accent) 75%, var(--fg));
      font-weight: 600;
    }

    .export-card {
      min-height: 100%;
    }

    .modes {
      display: grid;
      gap: 12px;
    }

    .mode {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: start;
      padding-bottom: 12px;
      border-bottom: 1px dashed var(--border);
    }

    .mode:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }

    .mode strong {
      display: block;
      font-size: 16px;
      letter-spacing: -0.01em;
      margin-bottom: 5px;
    }

    .mode span {
      display: block;
      font-size: 14px;
      color: var(--muted);
      line-height: 1.55;
      max-width: 34ch;
    }

    .tag {
      border-radius: 999px;
      padding: 8px 10px;
      font-size: 12px;
      background: color-mix(in oklab, var(--surface) 94%, white);
      border: 1px solid var(--border);
      white-space: nowrap;
    }

    .tweaks {
      position: fixed;
      inset-inline-end: 22px;
      inset-block-end: 22px;
      inline-size: min(300px, calc(100vw - 28px));
      border-radius: 20px;
      padding: 18px;
      display: grid;
      gap: 14px;
      box-shadow: 0 12px 32px color-mix(in oklab, var(--fg) 8%, transparent);
      backdrop-filter: blur(16px);
      background: color-mix(in oklab, var(--surface) 88%, white);
      z-index: 10;
    }

    .tweaks h2 {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
    }

    .tweaks label {
      display: grid;
      gap: 6px;
      font-size: 13px;
      color: var(--fg);
    }

    .tweaks select {
      inline-size: 100%;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: color-mix(in oklab, var(--surface) 96%, white);
      color: var(--fg);
      padding: 10px 12px;
    }

    .toggle {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
    }

    .toggle input {
      inline-size: 18px;
      block-size: 18px;
      accent-color: color-mix(in oklab, var(--accent) 74%, var(--fg));
    }

    @media (max-width: 1220px) {
      .app {
        grid-template-columns: 1fr;
        min-height: auto;
      }

      .sidebar {
        border-inline-end: 0;
        border-bottom: 1px solid var(--border);
      }

      .screen {
        min-height: auto;
      }

      .workbench,
      .editor-panes,
      .hero-grid,
      .series-grid,
      .export-grid,
      .chapter-grid,
      .metric-grid,
      .book-grid,
      .glossary-row {
        grid-template-columns: 1fr;
      }

      .span-7,
      .span-5,
      .span-4,
      .span-3,
      .span-8,
      .span-12 {
        grid-column: span 12;
      }
    }

    @media (max-width: 760px) {
      .app {
        width: calc(100vw - 20px);
        margin: 10px auto 108px;
        border-radius: 22px;
      }

      .screen {
        padding: 20px;
      }

      .screen-head h2,
      .workbench-title {
        font-size: 32px;
      }

      .tweaks {
        inset-inline: 10px;
        inline-size: auto;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="mark" aria-hidden="true">여</div>
        <div>
          <h1>여백</h1>
          <p>영어 EPUB 장편 시리즈를 한국어로 옮길 때, 읽기 흐름과 용어 일관성을 한 자리에서 관리하는 개인 번역 워크벤치.</p>
        </div>
      </div>

      <nav class="nav" aria-label="Primary">
        <button class="is-active" data-screen-target="library">
          <strong>라이브러리</strong>
          <span>불러온 시리즈, 권별 진행률, 다음 작업 큐</span>
        </button>
        <button data-screen-target="series">
          <strong>시리즈 상세</strong>
          <span>권 간 메모, 인물명 규칙, 챕터 상태 흐름</span>
        </button>
        <button data-screen-target="workbench">
          <strong>대조 편집기</strong>
          <span>원문과 번역문을 좌우로 나란히 놓고 교정</span>
        </button>
        <button data-screen-target="glossary">
          <strong>용어집</strong>
          <span>고유명사, 말투, 반복 표현의 기준 확정</span>
        </button>
        <button data-screen-target="export">
          <strong>내보내기</strong>
          <span>챕터 묶음, 개인 감상용 EPUB, 검수 체크</span>
        </button>
      </nav>

      <div class="side-card">
        <div class="eyebrow">오늘의 흐름</div>
        <h2>불러오기에서 번역 마감까지 한 호흡</h2>
        <div class="track-list">
          <div class="track-item"><span>1권 EPUB 분석 완료</span><span>toc 18장</span></div>
          <div class="track-item"><span>3장 대조 편집 진행 중</span><span>74%</span></div>
          <div class="track-item"><span>고유명사 규칙 12개 잠금</span><span>glossary</span></div>
          <div class="track-item"><span>최종 패키지 검수 대기</span><span>epub + txt</span></div>
        </div>
      </div>

      <div class="side-card">
        <div class="eyebrow">작업 원칙</div>
        <div class="mini-stack">
          <div class="small-note">로컬 우선 저장으로 개인 감상용 텍스트가 외부로 나가지 않습니다.</div>
          <div class="small-note">번역 메모는 시리즈 단위로 누적되어 다음 권에서도 그대로 불러옵니다.</div>
        </div>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="crumbs">
          <span>Library</span>
          <span>/</span>
          <strong>Lantern District Chronicles</strong>
          <span>/</span>
          <span>Volume 1 · Chapter 03</span>
        </div>
        <div class="toolbar-actions">
          <div class="pill">local-only</div>
          <button class="ghost" type="button">시리즈 메모</button>
          <button class="primary" type="button">작업 패키지 저장</button>
        </div>
      </header>

      <main class="screens">
        <section class="screen is-active" id="screen-library" aria-labelledby="library-title">
          <div class="screen-head">
            <div>
              <div class="eyebrow">Desktop-first translation app</div>
              <h2 id="library-title">개인 번역 라이브러리를 조용하게 정리하는 첫 화면</h2>
              <p>웹처럼 가볍게 보이되 데스크톱 작업량을 버티는 구조입니다. 시리즈별 진행률, 최근 번역한 챕터, 다음에 손댈 권을 한 시선 안에 모아 긴 장편 연재를 끊기지 않게 이어줍니다.</p>
            </div>
            <div class="head-actions">
              <button class="ghost" type="button">새 EPUB 불러오기</button>
              <button class="primary" type="button">최근 작업 이어서</button>
            </div>
          </div>

          <div class="hero-grid">
            <article class="panel hero-feature span-7">
              <div class="hero-topline">
                <div class="chip">장편 시리즈 번역</div>
                <div class="chip">챕터 단위 진행</div>
                <div class="chip">용어집 연동</div>
              </div>
              <div>
                <h3 class="section-title">읽는 흐름을 깨지 않으면서, 시리즈 전체 맥락은 잃지 않는 구조</h3>
              </div>
              <p>새 EPUB를 가져오면 목차를 장 단위로 정리하고, 현재 권의 번역 상태를 자동으로 큐에 올립니다. 최근 열었던 문단과 메모를 그대로 복원해 “어디까지 했더라”를 줄이는 데 집중했습니다.</p>
              <div class="metric-grid">
                <div class="metric">
                  <div class="panel-label">활성 시리즈</div>
                  <strong>03</strong>
                  <span>서로 다른 장편 세 편을 번갈아 보더라도 권별 컨텍스트를 분리 보관</span>
                </div>
                <div class="metric">
                  <div class="panel-label">이번 주 작업</div>
                  <strong>11장</strong>
                  <span>최근 일주일간 다시 연 챕터, 수정 횟수, 메모 남긴 세션을 함께 표시</span>
                </div>
                <div class="metric">
                  <div class="panel-label">잠금 용어</div>
                  <strong>42</strong>
                  <span>인명, 지명, 호칭, 말투 규칙을 시리즈 단위로 묶어 재사용</span>
                </div>
              </div>
            </article>

            <article class="panel span-5">
              <div class="eyebrow">최근 이어서 보기</div>
              <h3>Lantern District Chronicles</h3>
              <p>빅토리아풍 항구 도시를 배경으로 한 판타지 연작. 1권 3장 후반부에서 인물 호칭 정리가 필요한 상태입니다.</p>
              <div class="timeline">
                <div class="row">
                  <div>
                    <strong>03장 · The Lamp Tax</strong>
                    <p>세금 관련 행정 용어와 항만 시설 명칭을 한국어로 통일하는 중.</p>
                  </div>
                  <div class="tag">교정 74%</div>
                </div>
                <div class="row">
                  <div>
                    <strong>고유명사 검토</strong>
                    <p>quay / harbormaster / night dues 세 항목이 이전 권 메모와 충돌합니다.</p>
                  </div>
                  <div class="tag">3건 확인</div>
                </div>
                <div class="row">
                  <div>
                    <strong>내보내기 준비</strong>
                    <p>현재 권 임시 EPUB과 장별 텍스트를 각각 생성할 수 있습니다.</p>
                  </div>
                  <div class="tag">대기</div>
                </div>
              </div>
            </article>

            <article class="panel span-12">
              <div class="row">
                <div>
                  <div class="eyebrow">가져온 라이브러리</div>
                  <h3>권 단위 표지와 진행률만 보여 주고, 나머지는 필요할 때 열어 보는 밀도</h3>
                </div>
                <div class="chip">개인 감상용 로컬 프로젝트</div>
              </div>
              <div class="book-grid">
                <article class="book">
                  <div class="cover"><div class="cover-label">Vol. 1</div></div>
                  <div class="row">
                    <h3>Lantern District Chronicles</h3>
                    <div class="meta">18 chapters</div>
                  </div>
                  <p>항구 도시의 세무 기록과 실종 사건이 얽히는 첫 권. 번역 스타일의 기준이 되는 파일.</p>
                  <div class="progress"><span style="width:74%"></span></div>
                </article>
                <article class="book">
                  <div class="cover"><div class="cover-label">Vol. 2</div></div>
                  <div class="row">
                    <h3>The Quiet Docks</h3>
                    <div class="meta">22 chapters</div>
                  </div>
                  <p>등장인물 수가 늘어나는 권이라 인물 관계 메모와 호칭 규칙을 함께 묶어 둔 상태.</p>
                  <div class="progress"><span style="width:22%"></span></div>
                </article>
                <article class="book">
                  <div class="cover"><div class="cover-label">Vol. 3</div></div>
                  <div class="row">
                    <h3>Salt Ledger</h3>
                    <div class="meta">imported only</div>
                  </div>
                  <p>원문 분석만 끝난 대기 권. 고유명사 추출과 목차 정렬까지만 완료했습니다.</p>
                  <div class="progress"><span style="width:9%"></span></div>
                </article>
                <article class="book">
                  <div class="cover"><div class="cover-label">Side Story</div></div>
                  <div class="row">
                    <h3>Winter Wharf Notes</h3>
                    <div class="meta">8 chapters</div>
                  </div>
                  <p>외전 성격이라 본편 용어집을 일부 상속하되 인물 말투 규칙은 별도로 분리 보관.</p>
                  <div class="progress"><span style="width:48%"></span></div>
                </article>
              </div>
            </article>
          </div>
        </section>

        <section class="screen" id="screen-series" aria-labelledby="series-title">
          <div class="screen-head">
            <div>
              <div class="eyebrow">Series detail</div>
              <h2 id="series-title">권별 템포와 시리즈 메모를 한 층 더 깊게 보는 화면</h2>
              <p>장편 시리즈는 한 권 안에서만 정리해도 금세 무너집니다. 그래서 권별 진행률보다 먼저, 무엇을 다음 권까지 이어갈지 보이게 설계했습니다.</p>
            </div>
            <div class="head-actions">
              <button class="ghost" type="button">시리즈 노트 편집</button>
              <button class="primary" type="button">3장으로 이동</button>
            </div>
          </div>

          <div class="series-grid">
            <article class="panel series-banner span-8">
              <div class="eyebrow">Series memory</div>
              <h3 class="section-title">Lantern District Chronicles</h3>
              <p>19세기풍 항만 행정, 조세 장부, 가스등 점등 체계를 중심으로 돌아가는 세계관. 문체는 과장보다 건조함, 대사는 호칭 차이를 살리되 현대 구어를 피합니다.</p>
              <div class="series-meta">
                <div class="chip">인물명 음차 기준 확정</div>
                <div class="chip">행정 용어는 설명형 번역 우선</div>
                <div class="chip">항만 시설명은 각주 없이 본문 흡수</div>
              </div>
            </article>

            <article class="panel span-4">
              <div class="eyebrow">잠금 규칙</div>
              <div class="timeline">
                <div class="row">
                  <div>
                    <strong>harbormaster → 항만감독관</strong>
                    <p>‘항구 관리인’보다 직제 느낌을 유지하기 위해 행정 직함으로 고정.</p>
                  </div>
                </div>
                <div class="row">
                  <div>
                    <strong>night dues → 야간 하역세</strong>
                    <p>세금의 성격이 명확하게 드러나도록 합성어 형태 유지.</p>
                  </div>
                </div>
                <div class="row">
                  <div>
                    <strong>Mara의 어조</strong>
                    <p>단문 위주, 감탄 최소화. 판단은 빠르되 감정은 늦게 드러나게.</p>
                  </div>
                </div>
              </div>
            </article>

            <article class="panel span-12">
              <div class="row">
                <div>
                  <div class="eyebrow">권별 진행</div>
                  <h3>번역 상태, 검수 포인트, 다음 권으로 넘길 메모를 같은 카드에</h3>
                </div>
                <div class="chip">no cloud sync</div>
              </div>
              <div class="chapter-grid">
                <article class="chapter-card">
                  <div class="panel-label">Volume 1</div>
                  <h3>Lantern District Chronicles</h3>
                  <p>기준 권. 용어집과 문체 규칙이 가장 많이 쌓인 파일입니다.</p>
                  <div class="progress"><span style="width:74%"></span></div>
                  <div class="row"><span class="meta">18장 중 13장 교정</span><span class="issue">호칭 2건 확인</span></div>
                </article>
                <article class="chapter-card">
                  <div class="panel-label">Volume 2</div>
                  <h3>The Quiet Docks</h3>
                  <p>새 인물이 대거 등장하는 권. 인명 표기 표가 우선 열립니다.</p>
                  <div class="progress"><span style="width:22%"></span></div>
                  <div class="row"><span class="meta">22장 중 5장 초벌</span><span class="issue">지명 4건 대기</span></div>
                </article>
                <article class="chapter-card">
                  <div class="panel-label">Volume 3</div>
                  <h3>Salt Ledger</h3>
                  <p>읽기 메모만 먼저 쌓아 두는 단계. 핵심 상징어를 추출해 다음 권 준비.</p>
                  <div class="progress"><span style="width:9%"></span></div>
                  <div class="row"><span class="meta">목차 분석만 완료</span><span class="issue">스타일 메모 필요</span></div>
                </article>
              </div>
            </article>
          </div>
        </section>

        <section class="screen" id="screen-workbench" aria-labelledby="workbench-title">
          <div class="workbench">
            <div class="editor-shell">
              <div class="workbench-header">
                <div>
                  <div class="eyebrow">Dual-pane translator</div>
                  <h2 class="workbench-title" id="workbench-title">원문과 번역문이 같은 박자로 읽히는 대조 편집기</h2>
                  <p class="workbench-sub">원문을 길게 읽을 때는 문장 결이 보이고, 번역문을 다듬을 때는 한국어 리듬이 먼저 보이게 분할 비율을 조절할 수 있습니다. 챕터 메모와 용어 충돌은 오른쪽 보조 패널에 고정합니다.</p>
                </div>
                <div class="head-actions">
                  <button class="ghost" type="button">이전 장</button>
                  <button class="primary" type="button">다음 장</button>
                </div>
              </div>

              <div class="editor-toolbar">
                <div class="row">
                  <div class="pill">Vol. 1 · Chapter 03</div>
                  <div class="pill">paragraph alignment on</div>
                  <div class="pill">autosave 30s</div>
                </div>
                <div class="row">
                  <button class="ghost" type="button">영문 문단 합치기</button>
                  <button class="ghost" type="button">주석 접기</button>
                </div>
              </div>

              <div class="editor-panes">
                <article class="pane" aria-label="원문 패널">
                  <div class="pane-head">
                    <strong>Original EPUB</strong>
                    <span class="meta">chapter03.xhtml</span>
                  </div>
                  <div class="pane-body">
                    <div class="passage">
                      <div class="meta">¶ 18</div>
                      <div class="source">At the edge of the quay, Mara counted the lamps again. Eleven. The twelfth had gone dark sometime after midnight, and with it the last honest signal the harbor still kept.</div>
                      <div class="note">‘honest signal’은 의인화가 약하게 들어간 표현이라, 직역보다 항구의 신뢰가 사라진다는 뉘앙스를 살리는 쪽이 유리합니다.</div>
                    </div>
                    <div class="passage">
                      <div class="meta">¶ 19</div>
                      <div class="source">She closed the ledger with her thumb still between the pages, as if the numbers might try to escape before she had named the thief.</div>
                      <div class="note">장부와 도둑의 연결이 사건의 핵심 단서이므로, 수사 문장처럼 너무 무겁지 않게 유지.</div>
                    </div>
                    <div class="passage">
                      <div class="meta">¶ 20</div>
                      <div class="source">Below her, the night clerk cleared his throat, a respectful warning that the harbormaster had begun his descent.</div>
                      <div class="note">‘respectful warning’은 위계가 드러나는 표현입니다. 인물 간 직급 차이를 번역에서 분명히 보여 줍니다.</div>
                    </div>
                  </div>
                </article>

                <article class="pane" aria-label="번역문 패널">
                  <div class="pane-head">
                    <strong>Korean Translation</strong>
                    <span class="meta">draft-kor-v12</span>
                  </div>
                  <div class="pane-body">
                    <div class="passage">
                      <div class="meta">¶ 18</div>
                      <div class="translation">부두 끝에서 마라는 등불의 수를 다시 셌다. 열한 개. 열두 번째 불은 자정이 지난 뒤 어느 시점에 꺼졌고, 그와 함께 항구가 끝내 붙들고 있던 마지막 정상 신호도 사라졌다.</div>
                      <div class="note">‘honest’를 ‘정상’으로 옮겨 행정 기록의 어조를 살렸지만, 지나치게 차갑다면 ‘멀쩡한’으로 낮출 여지가 있습니다.</div>
                    </div>
                    <div class="passage">
                      <div class="meta">¶ 19</div>
                      <div class="translation">그녀는 엄지손가락을 페이지 사이에 끼운 채 장부를 덮었다. 숫자들이 범인의 이름을 적기 전에라도 도망치려 들 것처럼.</div>
                      <div class="note">문장 둘로 끊어 한국어 호흡을 먼저 살렸습니다. 장부의 생동감은 후반절에서 회수.</div>
                    </div>
                    <div class="passage">
                      <div class="meta">¶ 20</div>
                      <div class="translation">아래층에서 야간 서기가 헛기침을 했다. 항만감독관이 내려오기 시작했다는, 예를 갖춘 경고였다.</div>
                      <div class="note">직함은 시리즈 전체에서 ‘항만감독관’으로 잠금. 뒤 문장은 쉼표보다 마침표를 쓰면 경직되므로 여백을 남기는 쪽을 선택.</div>
                    </div>
                  </div>
                </article>
              </div>
            </div>

            <aside class="auxiliary">
              <section class="tile">
                <div class="eyebrow">실시간 충돌</div>
                <h3>이 장에서 다시 확인할 표현</h3>
                <ul class="glossary-list">
                  <li>
                    <div>
                      <strong>quay</strong>
                      <span>1권에서는 ‘부두’, 외전에서는 ‘선창’으로 번역됨</span>
                    </div>
                    <div class="tag">통일 필요</div>
                  </li>
                  <li>
                    <div>
                      <strong>night clerk</strong>
                      <span>‘야간 서기’ 유지 권장. ‘야근 서기’ 오타 감지됨</span>
                    </div>
                    <div class="tag">1건 수정</div>
                  </li>
                </ul>
              </section>

              <section class="tile">
                <div class="eyebrow">시리즈 메모</div>
                <h3>현재 화자의 리듬</h3>
                <p>마라는 상황 파악이 빠른 인물이라 서술문에 군더더기 감탄을 넣지 않습니다. 묘사는 짧게, 판단은 선명하게 유지합니다.</p>
              </section>

              <section class="stats">
                <article class="tile">
                  <div class="panel-label">이번 장</div>
                  <strong>1,482</strong>
                  <p>번역 완료 단어</p>
                </article>
                <article class="tile">
                  <div class="panel-label">검토 대기</div>
                  <strong>07</strong>
                  <p>용어 충돌 문단</p>
                </article>
              </section>

              <section class="tile">
                <div class="eyebrow">마감 체크</div>
                <ul class="checklist">
                  <li>
                    <div>
                      <strong>호칭 일관성</strong>
                      <span>감독관, 서기, 세리프 직함이 앞 권과 같은지 점검</span>
                    </div>
                  </li>
                  <li>
                    <div>
                      <strong>문단 길이 균형</strong>
                      <span>영문 1문단이 한국어 3문단 이상으로 과도하게 분리되지 않게 유지</span>
                    </div>
                  </li>
                </ul>
              </section>
            </aside>
          </div>
        </section>

        <section class="screen" id="screen-glossary" aria-labelledby="glossary-title">
          <div class="screen-head">
            <div>
              <div class="eyebrow">Glossary and consistency</div>
              <h2 id="glossary-title">시리즈 전체를 끌고 가는 이름과 말투의 기준표</h2>
              <p>장편 번역에서는 번역 실력보다 기억력 관리가 먼저 무너집니다. 용어집은 단순 표가 아니라, 왜 그렇게 정했는지까지 남겨 다음 권에서 망설임을 줄이는 구조로 설계했습니다.</p>
            </div>
            <div class="head-actions">
              <button class="ghost" type="button">CSV 가져오기</button>
              <button class="primary" type="button">잠금 규칙 저장</button>
            </div>
          </div>

          <article class="panel">
            <div class="row">
              <div>
                <div class="eyebrow">용어 기준표</div>
                <h3>원문, 고정 번역, 이유, 충돌 상태를 같은 행에서 확인</h3>
              </div>
              <div class="chip">series-level memory</div>
            </div>
            <div class="glossary-board">
              <div class="glossary-row">
                <div>
                  <strong>harbormaster</strong>
                  <span>행정 책임자 직함</span>
                </div>
                <div>
                  <strong>항만감독관</strong>
                  <span>고정 번역</span>
                </div>
                <div>
                  <strong>왜 이렇게 번역했는가</strong>
                  <span>해양 판타지지만 조직 체계가 현실 행정에 가까워, 추상적 호칭보다 직제를 보이는 쪽이 적합.</span>
                </div>
                <div>
                  <strong class="issue">충돌 없음</strong>
                  <span>최근 3권까지 동일</span>
                </div>
              </div>
              <div class="glossary-row">
                <div>
                  <strong>quay</strong>
                  <span>항만 접안 구역</span>
                </div>
                <div>
                  <strong>부두</strong>
                  <span>외전에서는 ‘선창’ 사용</span>
                </div>
                <div>
                  <strong>왜 이렇게 번역했는가</strong>
                  <span>본편은 행정·세무 맥락이 많아 가장 일반적인 ‘부두’가 읽기 흐름을 덜 끊음.</span>
                </div>
                <div>
                  <strong class="issue">충돌 1건</strong>
                  <span>외전 2장 표현 재검토 필요</span>
                </div>
              </div>
              <div class="glossary-row">
                <div>
                  <strong>night dues</strong>
                  <span>야간 하역 관련 세금</span>
                </div>
                <div>
                  <strong>야간 하역세</strong>
                  <span>설명형 번역</span>
                </div>
                <div>
                  <strong>왜 이렇게 번역했는가</strong>
                  <span>처음 등장하는 독자도 의미를 바로 파악해야 하므로 음역보다 기능 설명이 유리.</span>
                </div>
                <div>
                  <strong class="issue">메모 있음</strong>
                  <span>2권에서 과세 주체 설명 추가</span>
                </div>
              </div>
              <div class="glossary-row">
                <div>
                  <strong>Mara</strong>
                  <span>주인공</span>
                </div>
                <div>
                  <strong>마라</strong>
                  <span>말투 규칙 포함</span>
                </div>
                <div>
                  <strong>왜 이렇게 번역했는가</strong>
                  <span>발음이 짧고 단단한 인상이라 음차 유지. 대사는 감탄보다 관찰 중심으로 작성.</span>
                </div>
                <div>
                  <strong class="issue">스타일 잠금</strong>
                  <span>대사 예시 6개 저장</span>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section class="screen" id="screen-export" aria-labelledby="export-title">
          <div class="screen-head">
            <div>
              <div class="eyebrow">Export and handoff</div>
              <h2 id="export-title">개인 감상용 결과물을 정리해서 마감하는 마지막 화면</h2>
              <p>번역을 끝낸 뒤에는 어떤 형식으로 다시 읽을지, 원문 흔적을 어디까지 남길지 결정해야 합니다. 마지막 단계는 내보내기 자체보다 검수 순서가 더 중요하므로, 형식보다 체크리스트를 먼저 배치했습니다.</p>
            </div>
            <div class="head-actions">
              <button class="ghost" type="button">검수 리포트 보기</button>
              <button class="primary" type="button">EPUB 패키지 생성</button>
            </div>
          </div>

          <div class="export-grid">
            <article class="panel export-card span-7">
              <div class="eyebrow">내보내기 형식</div>
              <h3>읽기용 EPUB, 교정용 TXT, 백업용 프로젝트 스냅샷</h3>
              <div class="modes">
                <div class="mode">
                  <div>
                    <strong>개인 감상용 EPUB</strong>
                    <span>원문 주석은 접고 한국어 본문 중심으로 재패키징. 챕터 제목과 목차는 유지.</span>
                  </div>
                  <div class="tag">추천</div>
                </div>
                <div class="mode">
                  <div>
                    <strong>장별 텍스트 묶음</strong>
                    <span>교정 단계에서 비교하기 쉬운 UTF-8 TXT 묶음. 문단 번호 포함 여부를 선택 가능.</span>
                  </div>
                  <div class="tag">review</div>
                </div>
                <div class="mode">
                  <div>
                    <strong>프로젝트 스냅샷</strong>
                    <span>용어집, 시리즈 메모, 최근 위치까지 함께 저장해 다음 권 준비 파일로 남깁니다.</span>
                  </div>
                  <div class="tag">backup</div>
                </div>
              </div>
            </article>

            <article class="panel span-5">
              <div class="eyebrow">마감 전 확인</div>
              <div class="timeline">
                <div class="row">
                  <div>
                    <strong>문단 위치 복원 확인</strong>
                    <p>마지막으로 보던 문단이 새 파일에서도 정확히 복원되는지 점검.</p>
                  </div>
                  <div class="tag">필수</div>
                </div>
                <div class="row">
                  <div>
                    <strong>잠금 용어 재스캔</strong>
                    <p>권별 고정 번역이 마지막 장에서만 바뀌지 않았는지 자동 검색.</p>
                  </div>
                  <div class="tag">필수</div>
                </div>
                <div class="row">
                  <div>
                    <strong>메모 정리</strong>
                    <p>다음 권으로 가져갈 메모와 이번 권에만 유효한 메모를 분리 저장.</p>
                  </div>
                  <div class="tag">권장</div>
                </div>
              </div>
            </article>

            <article class="panel span-12">
              <div class="row">
                <div>
                  <div class="eyebrow">패키지 미리보기</div>
                  <h3>파일이 어떤 순서로 묶일지, 마지막 순간에 다시 확인</h3>
                </div>
                <div class="chip">last saved 11 May 2026</div>
              </div>
              <div class="chapter-grid">
                <article class="chapter-card">
                  <div class="panel-label">package</div>
                  <h3>lantern-v1-kor.epub</h3>
                  <p>표지 유지, 한국어 본문 반영, 원문 주석은 숨김 처리.</p>
                </article>
                <article class="chapter-card">
                  <div class="panel-label">review bundle</div>
                  <h3>chapter-01-18.txt</h3>
                  <p>문단 번호와 용어 충돌 표시가 포함된 교정용 텍스트 묶음.</p>
                </article>
                <article class="chapter-card">
                  <div class="panel-label">snapshot</div>
                  <h3>series-memory.json</h3>
                  <p>고유명사 규칙, 말투 메모, 최근 위치, 검수 체크 상태를 저장.</p>
                </article>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  </div>

  <aside class="tweaks" aria-label="Tweaks">
    <h2>Tweaks</h2>
    <label>
      현재 화면
      <select id="screenSelect">
        <option value="library">라이브러리</option>
        <option value="series">시리즈 상세</option>
        <option value="workbench">대조 편집기</option>
        <option value="glossary">용어집</option>
        <option value="export">내보내기</option>
      </select>
    </label>
    <label>
      정보 밀도
      <select id="densitySelect">
        <option value="cozy">Cozy</option>
        <option value="compact">Compact</option>
      </select>
    </label>
    <label>
      편집기 비율
      <select id="layoutSelect">
        <option value="balanced">Balanced</option>
        <option value="source">Source-first</option>
        <option value="translation">Translation-first</option>
      </select>
    </label>
    <label>
      액센트 톤
      <select id="accentSelect">
        <option value="default">Rust</option>
        <option value="moss">Moss</option>
        <option value="ink">Ink</option>
      </select>
    </label>
    <label class="toggle">
      집중 모드
      <input id="focusToggle" type="checkbox">
    </label>
    <label class="toggle">
      페이퍼 텍스처
      <input id="paperToggle" type="checkbox" checked>
    </label>
  </aside>

  <script>
    const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
      "screen": "workbench",
      "density": "cozy",
      "layout": "balanced",
      "accent": "default",
      "focusMode": false,
      "paperMode": true
    }/*EDITMODE-END*/;

    const STORAGE_KEY = "yeobaek-prototype-state-v1";
    const state = { ...TWEAK_DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };

    const screenSelect = document.getElementById("screenSelect");
    const densitySelect = document.getElementById("densitySelect");
    const layoutSelect = document.getElementById("layoutSelect");
    const accentSelect = document.getElementById("accentSelect");
    const focusToggle = document.getElementById("focusToggle");
    const paperToggle = document.getElementById("paperToggle");
    const navButtons = Array.from(document.querySelectorAll(".nav button"));
    const screens = Array.from(document.querySelectorAll(".screen"));

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function applyState() {
      document.body.dataset.density = state.density;
      document.body.dataset.layout = state.layout;
      document.body.dataset.accent = state.accent;
      document.body.dataset.focus = String(state.focusMode);
      document.body.dataset.paper = state.paperMode ? "on" : "off";

      screenSelect.value = state.screen;
      densitySelect.value = state.density;
      layoutSelect.value = state.layout;
      accentSelect.value = state.accent;
      focusToggle.checked = state.focusMode;
      paperToggle.checked = state.paperMode;

      navButtons.forEach((button) => {
        const active = button.dataset.screenTarget === state.screen;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-current", active ? "page" : "false");
      });

      screens.forEach((screen) => {
        screen.classList.toggle("is-active", screen.id === `screen-${state.screen}`);
      });
    }

    navButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.screen = button.dataset.screenTarget;
        saveState();
        applyState();
      });
    });

    screenSelect.addEventListener("change", (event) => {
      state.screen = event.target.value;
      saveState();
      applyState();
    });

    densitySelect.addEventListener("change", (event) => {
      state.density = event.target.value;
      saveState();
      applyState();
    });

    layoutSelect.addEventListener("change", (event) => {
      state.layout = event.target.value;
      saveState();
      applyState();
    });

    accentSelect.addEventListener("change", (event) => {
      state.accent = event.target.value;
      saveState();
      applyState();
    });

    focusToggle.addEventListener("change", (event) => {
      state.focusMode = event.target.checked;
      saveState();
      applyState();
    });

    paperToggle.addEventListener("change", (event) => {
      state.paperMode = event.target.checked;
      saveState();
      applyState();
    });

    applyState();
  </script>
</body>
</html>
