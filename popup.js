// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function videoIdFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('v');
  } catch { return null; }
}

function ytUrlAtTime(videoId, seconds) {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`;
}

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

function showToast(msg, type = '') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Custom select helpers ─────────────────────────────────────────────────────

function setupSelect(btnId, dropdownId, valueId, onSelect) {
  const btn = document.getElementById(btnId);
  const dropdown = document.getElementById(dropdownId);
  const valueEl = document.getElementById(valueId);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
      dropdown.classList.add('open');
      btn.classList.add('open');
    }
  });

  return {
    setItems(items /* [{label, value, active}] */) {
      dropdown.innerHTML = '';
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'dropdown-item' + (item.active ? ' active' : '');
        el.textContent = item.label;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          valueEl.textContent = item.label;
          closeAllDropdowns();
          onSelect(item.value, item.label);
        });
        dropdown.appendChild(el);
      });
    },
    setValue(label) { valueEl.textContent = label; },
    reset(placeholder) { valueEl.textContent = placeholder; }
  };
}

function closeAllDropdowns() {
  document.querySelectorAll('.select-dropdown').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.select-btn').forEach(b => b.classList.remove('open'));
}

document.addEventListener('click', closeAllDropdowns);

// ── State ─────────────────────────────────────────────────────────────────────

let allBookmarks = {}; // { videoId: { title, url, timestamps: [{id, time, note}] } }
let activeTab = null;
let currentVideoId = null;
let selectedVideoId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  const data = await getStorage(['bookmarks']);
  allBookmarks = data.bookmarks || {};

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;

  const vid = tab?.url ? videoIdFromUrl(tab.url) : null;
  currentVideoId = vid;

  renderCurrentSection();
  renderVideoList();
}

// ── Current video section ─────────────────────────────────────────────────────

function renderCurrentSection() {
  const sec = document.getElementById('currentSection');
  const notOnYt = document.getElementById('notOnYt');

  if (!currentVideoId) {
    sec.style.display = 'none';
    notOnYt.style.display = 'flex';
    return;
  }

  sec.style.display = 'block';
  notOnYt.style.display = 'none';

  // Get title from page or from stored bookmarks
  const stored = allBookmarks[currentVideoId];
  const title = stored?.title || activeTab?.title?.replace(' - YouTube', '') || 'YouTube Video';
  document.getElementById('currentTitle').textContent = title;

  // Poll current time from content script
  pollCurrentTime();
}

let timePoller = null;
function pollCurrentTime() {
  clearInterval(timePoller);
  timePoller = setInterval(async () => {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const v = document.querySelector('video');
          return v ? v.currentTime : null;
        }
      });
      if (result?.result != null) {
        document.getElementById('currentTime').textContent = formatTime(result.result);
      }
    } catch {}
  }, 500);
}

// ── Add timestamp ─────────────────────────────────────────────────────────────

document.getElementById('addTimestampBtn').addEventListener('click', async () => {
  if (!currentVideoId) return;

  let currentTime = 0;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        const v = document.querySelector('video');
        return v ? v.currentTime : 0;
      }
    });
    currentTime = result?.result ?? 0;
  } catch {}

  const title = activeTab?.title?.replace(' - YouTube', '') || 'YouTube Video';
  const url = activeTab?.url;

  // Ask for a note
  const note = prompt(`Add note for ${formatTime(currentTime)} (optional):`);
  if (note === null) return; // cancelled

  const entry = {
    id: Date.now(),
    time: currentTime,
    note: note.trim()
  };

  if (!allBookmarks[currentVideoId]) {
    allBookmarks[currentVideoId] = { title, url, timestamps: [] };
  } else {
    // keep title fresh
    allBookmarks[currentVideoId].title = title;
    allBookmarks[currentVideoId].url = url;
  }

  allBookmarks[currentVideoId].timestamps.push(entry);
  allBookmarks[currentVideoId].timestamps.sort((a, b) => a.time - b.time);

  await setStorage({ bookmarks: allBookmarks });

  showToast(`Timestamp saved at ${formatTime(currentTime)}`, 'success');
  renderVideoList();

  // If we're already viewing this video, refresh timestamps
  if (selectedVideoId === currentVideoId) {
    renderTimestamps(currentVideoId);
  }
});

// ── Video list ────────────────────────────────────────────────────────────────

let videoSelect;

function renderVideoList() {
  const emptyState = document.getElementById('emptyState');
  const wrapper = document.getElementById('videoListWrapper');
  const ids = Object.keys(allBookmarks);

  if (ids.length === 0) {
    emptyState.style.display = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  wrapper.style.display = 'block';

  if (!videoSelect) {
    videoSelect = setupSelect('videoSelectBtn', 'videoDropdown', 'videoSelectValue', onVideoSelected);
  }

  videoSelect.setItems(ids.map(id => ({
    label: allBookmarks[id].title,
    value: id,
    active: id === selectedVideoId
  })));
}

function onVideoSelected(videoId, label) {
  selectedVideoId = videoId;
  document.getElementById('timestampSection').style.display = 'block';
  renderTimestamps(videoId);
}

// ── Open video button ─────────────────────────────────────────────────────────

document.getElementById('openVideoBtn').addEventListener('click', () => {
  if (!selectedVideoId) return;
  const bk = allBookmarks[selectedVideoId];
  if (bk?.url) chrome.tabs.update({ url: bk.url });
});

// ── Timestamps ────────────────────────────────────────────────────────────────

let tsSelect;

function renderTimestamps(videoId) {
  const bk = allBookmarks[videoId];
  if (!bk) return;

  const list = document.getElementById('timestampList');
  const tsSection = document.getElementById('timestampSection');
  tsSection.style.display = 'block';

  const timestamps = bk.timestamps || [];

  // Rebuild timestamp dropdown
  if (!tsSelect) {
    tsSelect = setupSelect('tsSelectBtn', 'tsDropdown', 'tsSelectValue', (value) => {
      const t = parseFloat(value);
      navigateToTimestamp(videoId, t);
    });
  }

  tsSelect.setItems(timestamps.map(ts => ({
    label: `${formatTime(ts.time)}${ts.note ? ' — ' + ts.note : ''}`,
    value: String(ts.time)
  })));

  tsSelect.reset('Jump to timestamp…');

  // Render list
  list.innerHTML = '';

  if (timestamps.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#555;font-size:12px;padding:12px 0;text-align:center;';
    empty.textContent = 'No timestamps yet.';
    list.appendChild(empty);
    return;
  }

  timestamps.forEach(ts => {
    const row = document.createElement('div');
    row.className = 'ts-entry';

    const dot = document.createElement('div');
    dot.className = 'ts-dot';

    const body = document.createElement('div');
    body.className = 'ts-body';

    const timeEl = document.createElement('div');
    timeEl.className = 'ts-time';
    timeEl.textContent = formatTime(ts.time);
    timeEl.title = 'Click to jump';
    timeEl.addEventListener('click', () => navigateToTimestamp(videoId, ts.time));

    const noteEl = document.createElement('div');
    noteEl.className = 'ts-note' + (ts.note ? '' : ' empty');
    noteEl.textContent = ts.note || 'No note';

    body.appendChild(timeEl);
    body.appendChild(noteEl);

    const actions = document.createElement('div');
    actions.className = 'ts-actions';

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'ts-action-btn';
    editBtn.title = 'Edit note';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.addEventListener('click', async () => {
      const newNote = prompt('Edit note:', ts.note);
      if (newNote === null) return;
      ts.note = newNote.trim();
      await setStorage({ bookmarks: allBookmarks });
      renderTimestamps(videoId);
    });

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'ts-action-btn delete';
    delBtn.title = 'Delete';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
    delBtn.addEventListener('click', async () => {
      allBookmarks[videoId].timestamps = allBookmarks[videoId].timestamps.filter(t => t.id !== ts.id);
      // Clean up if no more timestamps
      if (allBookmarks[videoId].timestamps.length === 0) {
        delete allBookmarks[videoId];
        selectedVideoId = null;
        document.getElementById('timestampSection').style.display = 'none';
        videoSelect.reset('Select a video…');
      }
      await setStorage({ bookmarks: allBookmarks });
      renderVideoList();
      if (selectedVideoId) renderTimestamps(selectedVideoId);
      showToast('Timestamp deleted');
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(dot);
    row.appendChild(body);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

// ── Navigate to timestamp ─────────────────────────────────────────────────────

async function navigateToTimestamp(videoId, seconds) {
  const bk = allBookmarks[videoId];
  if (!bk) return;

  const url = ytUrlAtTime(videoId, seconds);

  // Check if that video is already open in a tab
  const tabs = await chrome.tabs.query({ url: `https://www.youtube.com/watch?v=${videoId}*` });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ── Refresh button ────────────────────────────────────────────────────────────

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const data = await getStorage(['bookmarks']);
  allBookmarks = data.bookmarks || {};
  renderCurrentSection();
  renderVideoList();
  if (selectedVideoId) {
    if (allBookmarks[selectedVideoId]) {
      renderTimestamps(selectedVideoId);
    } else {
      selectedVideoId = null;
      document.getElementById('timestampSection').style.display = 'none';
    }
  }
  showToast('Refreshed');
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();
