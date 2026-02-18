export function createDashboardState() {
  return {
    observations: [],
    timeline: [],
    selected: null,
    lastUpdated: null,
    refreshTimer: null,
    refreshPromise: null,
  };
}
