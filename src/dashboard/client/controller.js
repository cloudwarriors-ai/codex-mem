import { requestJson } from "./api.js";
import {
  DEFAULT_LIMIT,
  EVENT_REFRESH_DEBOUNCE_MS,
  REFRESH_INTERVAL_MS,
} from "./constants.js";
import { normalizePositiveInt, readErrorMessage, readInput } from "./helpers.js";
import {
  renderLocalStatsFallback,
  renderObservationList,
  renderProjectOptions,
  renderSelectionDetail,
  renderSessions,
  renderStats,
  renderTimelineList,
  showToast,
} from "./render.js";
import { createDashboardState } from "./state.js";

export class DashboardController {
  constructor(elements) {
    this.elements = elements;
    this.state = createDashboardState();
  }

  async init() {
    this.bindEvents();
    this.openEventStream();

    try {
      await this.refreshAll();
    } catch (error) {
      showToast(this.elements, `Startup failed: ${readErrorMessage(error)}`, true);
    }

    window.setInterval(() => {
      void this.refreshAll({ keepToastQuiet: true });
    }, REFRESH_INTERVAL_MS);
  }

  bindEvents() {
    this.elements.searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.runSearch();
      await this.loadContext();
    });

    this.elements.refreshBtn.addEventListener("click", async () => {
      await this.refreshAll();
      showToast(this.elements, "Memory refreshed");
    });

    this.elements.saveForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.saveMemory();
    });

    this.elements.projectSelect.addEventListener("change", async () => {
      const selected = readInput(this.elements.projectSelect.value);
      this.elements.searchCwd.value = selected;
      await this.refreshAll({ keepToastQuiet: true });
    });

    document.addEventListener("keydown", async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.elements.searchQuery.focus();
        this.elements.searchQuery.select();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "enter") {
        event.preventDefault();
        await this.runSearch();
      }
    });
  }

  openEventStream() {
    if (typeof EventSource === "undefined") return;

    const source = new EventSource("/api/events");
    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "sync") {
        this.elements.syncStatus.textContent = `LIVE · ${new Date(payload.at).toLocaleTimeString()}`;
        this.scheduleEventRefresh();
        return;
      }

      if (payload.type === "sync_error") {
        showToast(this.elements, `Background sync error: ${payload.message}`, true);
      }
    };

    source.onerror = () => {
      this.elements.syncStatus.textContent = "DEGRADED";
    };
  }

  scheduleEventRefresh() {
    if (this.state.refreshTimer) {
      window.clearTimeout(this.state.refreshTimer);
    }

    this.state.refreshTimer = window.setTimeout(() => {
      void this.refreshAll({ keepToastQuiet: true });
      this.state.refreshTimer = null;
    }, EVENT_REFRESH_DEBOUNCE_MS);
  }

  async refreshAll(options) {
    if (this.state.refreshPromise) {
      return this.state.refreshPromise;
    }

    this.state.refreshPromise = (async () => {
      await Promise.all([
        this.loadHealth(),
        this.loadProjects(),
        this.runSearch(),
        this.loadContext(),
      ]);

      if (!options?.keepToastQuiet) {
        renderSelectionDetail(this.elements, this.state);
      }
    })().finally(() => {
      this.state.refreshPromise = null;
    });

    return this.state.refreshPromise;
  }

  async loadHealth() {
    try {
      const data = await requestJson("/api/health");
      const timestamp = new Date().toLocaleTimeString();
      this.elements.syncStatus.textContent = data?.status === "ok" ? `LIVE · ${timestamp}` : "DEGRADED";
    } catch {
      this.elements.syncStatus.textContent = "OFFLINE";
    }
  }

  async loadProjects() {
    try {
      const data = await requestJson("/api/projects?limit=40");
      const projects = Array.isArray(data.projects) ? data.projects : [];
      const currentScope = readInput(this.elements.searchCwd.value);
      renderProjectOptions(this.elements, projects, currentScope);
    } catch {
      // Keep existing select options.
    }
  }

  async runSearch() {
    this.elements.syncStatus.textContent = "SYNCING...";

    const params = new URLSearchParams();
    const query = readInput(this.elements.searchQuery.value);
    const limit = normalizePositiveInt(this.elements.searchLimit.value, DEFAULT_LIMIT);
    const type = readInput(this.elements.searchType.value);
    const cwd = readInput(this.elements.searchCwd.value);

    if (query) params.set("query", query);
    if (type) params.set("type", type);
    if (cwd) params.set("cwd", cwd);
    params.set("limit", String(limit));

    try {
      const data = await requestJson(`/api/search?${params.toString()}`);
      this.state.observations = Array.isArray(data.observations) ? data.observations : [];
      this.state.lastUpdated = new Date();

      this.reconcileSelection();
      renderObservationList(this.elements, this.state, async (next) => {
        await this.selectObservation(next);
      });
      renderSelectionDetail(this.elements, this.state);

      await Promise.all([
        this.runTimelineForSelection(),
        this.loadStats(),
        this.loadSessions(),
      ]);

      this.elements.syncStatus.textContent = `LIVE · ${this.state.lastUpdated.toLocaleTimeString()}`;
    } catch (error) {
      showToast(this.elements, `Search failed: ${readErrorMessage(error)}`, true);
      this.elements.syncStatus.textContent = "OFFLINE";
    }
  }

  reconcileSelection() {
    if (this.state.selected) {
      const latest = this.state.observations.find((row) => row.id === this.state.selected.id);
      this.state.selected = latest ?? null;
    }

    if (!this.state.selected && this.state.observations.length > 0) {
      this.state.selected = this.state.observations[0] ?? null;
    }
  }

  async runTimelineForSelection() {
    if (!this.state.selected) {
      this.state.timeline = [];
      renderTimelineList(this.elements, this.state, async (next) => {
        await this.selectObservation(next);
      });
      return;
    }

    const params = new URLSearchParams();
    params.set("anchor", String(this.state.selected.id));
    params.set("before", "6");
    params.set("after", "6");

    const cwd = readInput(this.elements.searchCwd.value);
    if (cwd) params.set("cwd", cwd);

    try {
      const data = await requestJson(`/api/timeline?${params.toString()}`);
      this.state.timeline = Array.isArray(data.observations) ? data.observations : [];
    } catch (error) {
      this.state.timeline = [];
      showToast(this.elements, `Timeline failed: ${readErrorMessage(error)}`, true);
    }

    renderTimelineList(this.elements, this.state, async (next) => {
      await this.selectObservation(next);
    });
  }

  async loadStats() {
    const params = new URLSearchParams();
    const cwd = readInput(this.elements.searchCwd.value);
    if (cwd) params.set("cwd", cwd);

    try {
      const data = await requestJson(`/api/stats?${params.toString()}`);
      renderStats(this.elements, data.stats || {});
    } catch {
      renderLocalStatsFallback(this.elements, this.state.observations);
    }
  }

  async loadSessions() {
    const params = new URLSearchParams();
    const cwd = readInput(this.elements.searchCwd.value);
    if (cwd) params.set("cwd", cwd);
    params.set("limit", "8");

    try {
      const data = await requestJson(`/api/sessions?${params.toString()}`);
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      renderSessions(this.elements, sessions);
    } catch {
      this.elements.sessionList.innerHTML = '<div class="empty-state">Session list unavailable.</div>';
    }
  }

  async loadContext() {
    const params = new URLSearchParams();
    params.set("limit", "8");

    const query = readInput(this.elements.searchQuery.value);
    const cwd = readInput(this.elements.searchCwd.value);
    const type = readInput(this.elements.searchType.value);

    if (query) params.set("query", query);
    if (cwd) params.set("cwd", cwd);
    if (type) params.set("type", type);

    try {
      const data = await requestJson(`/api/context?${params.toString()}`);
      this.elements.contextBox.textContent = data.context || "No context available.";
    } catch {
      this.elements.contextBox.textContent = "Context load failed.";
    }
  }

  async saveMemory() {
    const text = readInput(this.elements.saveText.value);
    if (!text) {
      showToast(this.elements, "Memory text is required.", true);
      return;
    }

    const payload = { text };
    const title = readInput(this.elements.saveTitle.value);
    const cwd = readInput(this.elements.saveCwd.value);
    if (title) payload.title = title;
    if (cwd) payload.cwd = cwd;

    try {
      const result = await requestJson("/api/save_memory", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      this.elements.saveText.value = "";
      showToast(this.elements, `Saved memory #${result.id}`);
      await this.refreshAll({ keepToastQuiet: true });
    } catch (error) {
      showToast(this.elements, `Save failed: ${readErrorMessage(error)}`, true);
    }
  }

  async selectObservation(next) {
    this.state.selected = next;

    renderObservationList(this.elements, this.state, async (selected) => {
      await this.selectObservation(selected);
    });
    renderTimelineList(this.elements, this.state, async (selected) => {
      await this.selectObservation(selected);
    });
    renderSelectionDetail(this.elements, this.state);

    await this.runTimelineForSelection();
  }
}
