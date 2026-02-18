export function getElements() {
  return {
    searchForm: requiredById("search-form", HTMLFormElement),
    searchQuery: requiredById("search-query", HTMLInputElement),
    searchLimit: requiredById("search-limit", HTMLInputElement),
    searchType: requiredById("search-type", HTMLSelectElement),
    searchCwd: requiredById("search-cwd", HTMLInputElement),
    projectSelect: requiredById("project-select", HTMLSelectElement),
    sessionList: requiredById("session-list", HTMLElement),
    refreshBtn: requiredById("refresh-btn", HTMLButtonElement),
    syncStatus: requiredById("sync-status", HTMLElement),
    obsList: requiredById("obs-list", HTMLElement),
    timelineList: requiredById("timeline-list", HTMLElement),
    detailBody: requiredById("detail-body", HTMLElement),
    contextBox: requiredById("context-box", HTMLElement),
    statTotal: requiredById("stat-total", HTMLElement),
    statUser: requiredById("stat-user", HTMLElement),
    statAssistant: requiredById("stat-assistant", HTMLElement),
    statTools: requiredById("stat-tools", HTMLElement),
    statProjects: requiredById("stat-projects", HTMLElement),
    statSessions: requiredById("stat-sessions", HTMLElement),
    saveForm: requiredById("save-form", HTMLFormElement),
    saveTitle: requiredById("save-title", HTMLInputElement),
    saveText: requiredById("save-text", HTMLTextAreaElement),
    saveCwd: requiredById("save-cwd", HTMLInputElement),
    toast: requiredById("toast", HTMLElement),
  };
}

function requiredById(id, ctor) {
  const node = document.getElementById(id);
  if (!(node instanceof ctor)) {
    throw new Error(`Missing required element: ${id}`);
  }
  return node;
}
