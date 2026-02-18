export const DASHBOARD_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root {
  --bg-0: #f7f4ee;
  --bg-1: #efe8dc;
  --ink-0: #1f1c19;
  --ink-1: #514a42;
  --ink-2: #776f66;
  --line: #d4c8b8;
  --accent: #0f7a64;
  --card: rgba(255, 253, 250, 0.82);
  --card-strong: rgba(255, 253, 250, 0.95);
  --shadow: 0 14px 30px rgba(30, 24, 17, 0.12);
  --mono: "IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace;
  --sans: "Sora", "Avenir Next", "Segoe UI", sans-serif;
  --radius-lg: 20px;
  --radius-md: 14px;
  --radius-sm: 10px;
}

* { box-sizing: border-box; }

html,
body {
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(circle at 4% 6%, rgba(15, 122, 100, 0.16), transparent 40%),
    radial-gradient(circle at 92% 2%, rgba(184, 92, 46, 0.17), transparent 35%),
    linear-gradient(165deg, var(--bg-0), var(--bg-1));
  color: var(--ink-0);
  font-family: var(--sans);
}

body { padding: 18px; }

.app-shell {
  width: min(1500px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 330px 1fr 360px;
  gap: 18px;
  min-height: calc(100vh - 36px);
}

.panel {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  backdrop-filter: blur(9px);
  overflow: hidden;
}

.left-panel { display: flex; flex-direction: column; }

.brand {
  padding: 22px 20px 12px;
  border-bottom: 1px dashed var(--line);
}

.brand h1 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.brand p {
  margin: 8px 0 0;
  color: var(--ink-2);
  font-size: 0.88rem;
  line-height: 1.5;
}

.side-section {
  padding: 18px;
  border-bottom: 1px dashed var(--line);
}

.side-section h2 {
  margin: 0 0 12px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-2);
}

.field { margin-bottom: 12px; }

.field label {
  display: block;
  font-size: 0.77rem;
  color: var(--ink-2);
  margin-bottom: 6px;
}

input,
select,
textarea,
button {
  width: 100%;
  font: inherit;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

input,
select,
textarea {
  padding: 11px 12px;
  background: var(--card-strong);
  color: var(--ink-0);
}

textarea {
  min-height: 94px;
  resize: vertical;
}

button {
  cursor: pointer;
  padding: 11px 12px;
  font-weight: 600;
  transition: transform 170ms ease, box-shadow 170ms ease, background 170ms ease;
}

button:hover { transform: translateY(-1px); }

.btn-primary {
  background: linear-gradient(110deg, var(--accent), #0f6f5b);
  color: #f5fff9;
  border-color: transparent;
  box-shadow: 0 10px 20px rgba(15, 122, 100, 0.22);
}

.btn-secondary { background: var(--card-strong); color: var(--ink-0); }
.btn-secondary:hover { background: #fff; }

.meta-row,
.row-inline {
  display: flex;
  gap: 8px;
}

.meta-row > *,
.row-inline > * {
  flex: 1;
}

.center-panel { display: grid; grid-template-rows: auto auto 1fr; }

.topbar {
  padding: 18px 20px;
  border-bottom: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.topbar h2 {
  margin: 0;
  font-size: 1.02rem;
  letter-spacing: -0.02em;
}

.sync-pill {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: #0f6f5b;
  background: rgba(15, 122, 100, 0.12);
  border: 1px solid rgba(15, 122, 100, 0.3);
  border-radius: 999px;
  padding: 5px 10px;
  white-space: nowrap;
}

.stats {
  padding: 14px 20px 4px;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.stat-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card-strong);
  padding: 12px;
}

.stat-card h3 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-2);
}

.stat-card p {
  margin: 10px 0 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.feed-wrap {
  overflow: auto;
  padding: 6px 20px 20px;
}

.feed-section-title {
  margin: 14px 2px 8px;
  font-size: 0.75rem;
  color: var(--ink-2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.item {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card-strong);
  padding: 12px;
  cursor: pointer;
  transition: border-color 170ms ease, transform 170ms ease, box-shadow 170ms ease;
}

.item:hover {
  border-color: rgba(15, 122, 100, 0.4);
  transform: translateY(-1px);
  box-shadow: 0 9px 18px rgba(35, 30, 24, 0.08);
}

.item.active {
  border-color: rgba(15, 122, 100, 0.6);
  box-shadow: 0 0 0 2px rgba(15, 122, 100, 0.15);
}

.item-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.badge.user_message { background: rgba(184, 92, 46, 0.13); color: #995022; }
.badge.assistant_message { background: rgba(15, 122, 100, 0.15); color: #0a624f; }
.badge.tool_call { background: rgba(33, 101, 170, 0.13); color: #1e5d95; }
.badge.tool_output { background: rgba(102, 102, 102, 0.15); color: #555; }
.badge.manual_note { background: rgba(122, 66, 190, 0.15); color: #5e3495; }

.item-time {
  font-family: var(--mono);
  color: var(--ink-2);
  font-size: 0.72rem;
}

.item-title {
  margin: 8px 0 5px;
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.45;
}

.item-text {
  margin: 0;
  color: var(--ink-1);
  font-size: 0.84rem;
  line-height: 1.45;
}

.right-panel { display: grid; grid-template-rows: auto 1fr auto; }

.detail-head {
  padding: 18px 20px 12px;
  border-bottom: 1px dashed var(--line);
}

.detail-head h2 {
  margin: 0;
  font-size: 0.92rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-2);
}

.detail-body {
  padding: 16px 20px;
  overflow: auto;
}

.empty-state {
  color: var(--ink-2);
  font-size: 0.87rem;
  line-height: 1.6;
}

.detail-title {
  margin: 0;
  font-size: 1.04rem;
  font-weight: 700;
  line-height: 1.45;
}

.detail-meta {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--ink-2);
}

.detail-text,
.context-text {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card-strong);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.84rem;
  line-height: 1.6;
}

.context-wrap {
  padding: 14px 20px 18px;
  border-top: 1px dashed var(--line);
}

.context-wrap h3 {
  margin: 0 0 8px;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-2);
}

.context-text {
  max-height: 180px;
  overflow: auto;
  margin-top: 0;
  font-family: var(--mono);
  font-size: 0.75rem;
}

.mini-list {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card-strong);
  max-height: 210px;
  overflow: auto;
}

.mini-item {
  display: block;
  padding: 9px 10px;
  border-bottom: 1px dashed var(--line);
  text-decoration: none;
  color: inherit;
}

.mini-item:last-child {
  border-bottom: none;
}

.mini-item strong {
  display: block;
  font-size: 0.76rem;
  font-family: var(--mono);
}

.mini-item span {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--ink-2);
}

.toast {
  position: fixed;
  right: 22px;
  bottom: 22px;
  min-width: 240px;
  max-width: 420px;
  padding: 10px 13px;
  border-radius: 12px;
  background: #1f1b18;
  color: #fbf5ef;
  font-size: 0.82rem;
  border: 1px solid rgba(255, 255, 255, 0.13);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 220ms ease, transform 220ms ease;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

.toast.error {
  background: #431d1d;
  border-color: rgba(208, 71, 71, 0.44);
}

@media (max-width: 1240px) {
  .app-shell { grid-template-columns: 300px 1fr; }
  .right-panel { grid-column: 1 / -1; grid-template-rows: auto auto auto; }
}

@media (max-width: 900px) {
  body { padding: 10px; }
  .app-shell { grid-template-columns: 1fr; gap: 12px; min-height: auto; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .topbar { gap: 10px; align-items: flex-start; flex-direction: column; }
}
`;
