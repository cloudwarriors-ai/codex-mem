export function renderDashboardHtml(input?: {
  title?: string;
  stylesPath?: string;
  scriptPath?: string;
}): string {
  const title = input?.title ?? "codex-mem atlas";
  const stylesPath = input?.stylesPath ?? "/assets/dashboard.css";
  const scriptPath = input?.scriptPath ?? "/assets/dashboard.js";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="${stylesPath}" />
  </head>
  <body>
    <main class="app-shell">
      <aside class="panel left-panel">
        <section class="brand">
          <h1>codex-mem atlas</h1>
          <p>Persistent memory stream for Codex. Search intent, replay context, and pin durable notes.</p>
        </section>

        <section class="side-section">
          <h2>Search Memory</h2>
          <form id="search-form">
            <div class="field">
              <label for="search-query">Query</label>
              <input id="search-query" placeholder="schema migration rollback" autocomplete="off" />
            </div>

            <div class="meta-row">
              <div class="field">
                <label for="search-limit">Limit</label>
                <input id="search-limit" type="number" min="1" max="100" value="24" />
              </div>
              <div class="field">
                <label for="search-type">Type</label>
                <select id="search-type">
                  <option value="">All (signal-first)</option>
                  <option value="user_message">User</option>
                  <option value="assistant_message">Assistant</option>
                  <option value="tool_call">Tool Call</option>
                  <option value="tool_output">Tool Output</option>
                  <option value="manual_note">Manual Note</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label for="search-cwd">CWD (optional)</label>
              <input id="search-cwd" placeholder="/Users/chadsimon/code/..." autocomplete="off" />
            </div>

            <div class="row-inline">
              <button type="submit" class="btn-primary">Search</button>
              <button type="button" class="btn-secondary" id="refresh-btn">Refresh</button>
            </div>
          </form>
        </section>

        <section class="side-section">
          <h2>Project Lens</h2>
          <div class="field">
            <label for="project-select">Project Scope</label>
            <select id="project-select">
              <option value="">All Projects</option>
            </select>
          </div>
          <div class="field">
            <label>Recent Sessions</label>
            <div class="mini-list" id="session-list">
              <div class="empty-state">No sessions loaded yet.</div>
            </div>
          </div>
        </section>

        <section class="side-section" style="border-bottom:none;">
          <h2>Save Memory</h2>
          <form id="save-form">
            <div class="field">
              <label for="save-title">Title</label>
              <input id="save-title" placeholder="Migration lock rule" autocomplete="off" />
            </div>
            <div class="field">
              <label for="save-text">Memory</label>
              <textarea id="save-text" placeholder="What should future Codex runs remember?"></textarea>
            </div>
            <div class="field">
              <label for="save-cwd">CWD (optional)</label>
              <input id="save-cwd" placeholder="/Users/chadsimon/code/project" autocomplete="off" />
            </div>
            <button type="submit" class="btn-primary">Save Memory</button>
          </form>
        </section>
      </aside>

      <section class="panel center-panel">
        <header class="topbar">
          <h2>Signal Feed</h2>
          <div class="sync-pill" id="sync-status">Booting...</div>
        </header>

        <section class="stats">
          <article class="stat-card"><h3>Total</h3><p id="stat-total">0</p></article>
          <article class="stat-card"><h3>User</h3><p id="stat-user">0</p></article>
          <article class="stat-card"><h3>Assistant</h3><p id="stat-assistant">0</p></article>
          <article class="stat-card"><h3>Tools</h3><p id="stat-tools">0</p></article>
          <article class="stat-card"><h3>Projects</h3><p id="stat-projects">0</p></article>
          <article class="stat-card"><h3>Sessions</h3><p id="stat-sessions">0</p></article>
        </section>

        <div class="feed-wrap">
          <div class="feed-section-title">Search Results</div>
          <div class="list" id="obs-list"></div>

          <div class="feed-section-title">Timeline Around Selection</div>
          <div class="list" id="timeline-list"></div>
        </div>
      </section>

      <aside class="panel right-panel">
        <header class="detail-head">
          <h2>Memory Detail</h2>
        </header>

        <section class="detail-body" id="detail-body">
          <div class="empty-state">Select an observation to inspect full memory details.</div>
        </section>

        <section class="context-wrap">
          <h3>Prompt Context Preview</h3>
          <pre class="context-text" id="context-box">Loading context...</pre>
        </section>
      </aside>
    </main>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>

    <script type="module" src="${scriptPath}"></script>
  </body>
</html>`;
}
