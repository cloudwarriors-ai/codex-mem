import { SHORT_TEXT_LIMIT, TIMELINE_TEXT_LIMIT } from "./constants.js";
import { escapeHtml, formatTime, shorten } from "./helpers.js";

let toastTimer = null;

export function showToast(el, message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("error", isError);
  el.toast.classList.add("show");

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    el.toast.classList.remove("show");
  }, 2600);
}

export function renderObservationList(el, state, onSelect) {
  const rows = state.observations;
  if (rows.length === 0) {
    el.obsList.innerHTML = '<div class="empty-state">No memory observations found for this filter.</div>';
    return;
  }

  el.obsList.innerHTML = rows
    .map((row) => renderCard(row, row.id === state.selected?.id, SHORT_TEXT_LIMIT))
    .join("");

  bindCardClicks(el.obsList, rows, onSelect);
}

export function renderTimelineList(el, state, onSelect) {
  const rows = state.timeline;
  if (rows.length === 0) {
    el.timelineList.innerHTML = '<div class="empty-state">Timeline is empty for the current selection.</div>';
    return;
  }

  el.timelineList.innerHTML = rows
    .map((row) => renderCard(row, row.id === state.selected?.id, TIMELINE_TEXT_LIMIT))
    .join("");

  bindCardClicks(el.timelineList, rows, onSelect);
}

export function renderSelectionDetail(el, state) {
  const selected = state.selected;
  if (!selected) {
    el.detailBody.innerHTML = '<div class="empty-state">Select an observation to inspect full memory details.</div>';
    return;
  }

  el.detailBody.innerHTML =
    `<h3 class="detail-title">${escapeHtml(selected.title || "(untitled)")}</h3>` +
    `<p class="detail-meta">ID #${selected.id} · ${escapeHtml(selected.type)} · ${formatTime(selected.createdAt)}</p>` +
    (selected.cwd ? `<p class="detail-meta">cwd: ${escapeHtml(selected.cwd)}</p>` : "") +
    `<div class="detail-text">${escapeHtml(selected.text)}</div>`;
}

export function renderStats(el, stats) {
  el.statTotal.textContent = String(stats.total || 0);
  el.statUser.textContent = String(stats.userMessages || 0);
  el.statAssistant.textContent = String(stats.assistantMessages || 0);
  el.statTools.textContent = String(stats.toolEvents || 0);
  el.statProjects.textContent = String(stats.uniqueProjects || 0);
  el.statSessions.textContent = String(stats.uniqueSessions || 0);
}

export function renderLocalStatsFallback(el, observations) {
  const userCount = observations.filter((row) => row.type === "user_message").length;
  const assistantCount = observations.filter((row) => row.type === "assistant_message").length;
  const toolCount = observations.filter(
    (row) => row.type === "tool_call" || row.type === "tool_output",
  ).length;

  el.statTotal.textContent = String(observations.length);
  el.statUser.textContent = String(userCount);
  el.statAssistant.textContent = String(assistantCount);
  el.statTools.textContent = String(toolCount);
  el.statProjects.textContent = "-";
  el.statSessions.textContent = "-";
}

export function renderProjectOptions(el, projects, currentScope) {
  const options = ['<option value="">All Projects</option>'];

  for (const row of projects) {
    const cwd = row.cwd || "";
    if (!cwd) continue;
    options.push(`<option value="${escapeHtml(cwd)}">${escapeHtml(cwd)}</option>`);
  }

  el.projectSelect.innerHTML = options.join("");

  if (!currentScope) {
    el.projectSelect.value = "";
    return;
  }

  const existing = projects.some((row) => row.cwd === currentScope);
  if (!existing) {
    const option = document.createElement("option");
    option.value = currentScope;
    option.textContent = currentScope;
    el.projectSelect.appendChild(option);
  }

  el.projectSelect.value = currentScope;
}

export function renderSessions(el, sessions) {
  if (sessions.length === 0) {
    el.sessionList.innerHTML = '<div class="empty-state">No recent sessions for this scope.</div>';
    return;
  }

  el.sessionList.innerHTML = sessions
    .map((session) => {
      const shortId = String(session.sessionId || "").slice(-8);
      const stamp = formatTime(session.lastAt);
      const title = escapeHtml(shorten(session.lastTitle || "(no title)", 80));

      return (
        `<div class="mini-item">` +
        `<strong>${escapeHtml(shortId)}</strong>` +
        `<span>${title}</span>` +
        `<span>${escapeHtml(stamp)} · ${Number(session.observationCount || 0)} obs</span>` +
        `</div>`
      );
    })
    .join("");
}

function renderCard(row, active, textLimit) {
  const activeClass = active ? "active" : "";

  return (
    `<article class="item ${activeClass}" data-id="${row.id}">` +
    `<div class="item-head">` +
    `<span class="badge ${row.type}">${row.type.replace("_", " ")}</span>` +
    `<span class="item-time">#${row.id} · ${formatTime(row.createdAt)}</span>` +
    `</div>` +
    `<h4 class="item-title">${escapeHtml(row.title || "(untitled)")}</h4>` +
    `<p class="item-text">${escapeHtml(shorten(row.text, textLimit))}</p>` +
    `</article>`
  );
}

function bindCardClicks(root, rows, onSelect) {
  for (const node of root.querySelectorAll(".item")) {
    node.addEventListener("click", async () => {
      const id = Number(node.getAttribute("data-id"));
      const next = rows.find((row) => row.id === id);
      if (!next) return;
      await onSelect(next);
    });
  }
}
