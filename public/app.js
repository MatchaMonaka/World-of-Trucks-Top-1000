(() => {
  const KM_PER_MILE = 1.609344;
  const COOKIE_MAX_AGE_DAYS = 365;

  function setCookie(name, value) {
    const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  }

  function getCookie(name) {
    const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  let players = [];          // raw data from /api/leaderboard (fixed global-distance order + rank)
  let mode = 'global';       // global | euro | american
  let unit = 'km';           // km | mi
  // Multi-key sort: earlier entries have higher priority.
  const DEFAULT_SORT = () => [{ key: 'distance', dir: 'desc' }];
  let sortKeys = DEFAULT_SORT();
  let pageSize = 100;        // one of allowedPageSizes

  // Server-provided settings (overwritten by data.config from /api/leaderboard).
  // The values below are only fallbacks used until the first response arrives.
  let refreshCooldownMs = 8 * 60 * 60 * 1000;
  let newPlayerCooldownMs = 60 * 1000;
  let maxDisplay = 1000;
  let allowedPageSizes = [100, 200, 250, 500, 1000];
  let searchQuery = '';      // matches against player name / country name / country code
  let currentPage = 0;       // 0-indexed

  // Restore persisted preferences (Distance Unit / page size) from cookies.
  const savedUnit = getCookie('wot_unit');
  if (savedUnit === 'km' || savedUnit === 'mi') unit = savedUnit;

  const savedPageSize = Number(getCookie('wot_pageSize'));
  if (allowedPageSizes.includes(savedPageSize)) pageSize = savedPageSize;


  const boardBody = document.getElementById('boardBody');
  const statusMsg = document.getElementById('statusMsg');

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
    statusMsg.hidden = false;
  }
  function hideStatus() {
    statusMsg.hidden = true;
  }

  function fmtInt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function fmtDistance(km) {
    if (!km) return '-';
    const val = unit === 'mi' ? km / KM_PER_MILE : km;
    return `${val.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${unit}`;
  }

  function fmtDistance1dp(km) {
    if (!km) return '-';
    const val = unit === 'mi' ? km / KM_PER_MILE : km;
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
  }

  function fmtSpeed(kmh) {
    if (!kmh) return '-';
    const val = unit === 'mi' ? kmh / KM_PER_MILE : kmh;
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}/h`;
  }

  // Signed difference from the median Avg Speed, e.g. "+3.21%" / "-12.50%".
  function fmtSpeedDiff(kmh) {
    const d = speedDiffPct(kmh);
    if (d === null) return '-';
    const r = Math.round(d * 100) / 100;
    return `${r < 0 ? '-' : '+'}${Math.abs(r).toFixed(2)}%`;
  }

  function fmtMass(t) {
    if (!t) return '-';
    return `${fmtInt(t)} t`;
  }

  function fmtTime(min) {
    if (!min) return '-';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${fmtInt(h)} h ${m} min`;
  }

  function fmtAgo(ts) {
    if (!ts) return '-';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function flagImg(row) {
    if (!row.country_code) return `<span title="Unknown">🏳️</span>`;
    // Served by our own server (/flags/:code.png), which caches the image
    // locally on first request instead of hotlinking worldoftrucks.com directly.
    const src = `/flags/${row.country_code}.png`;
    const title = escapeHtml(row.country_name || row.country_code.toUpperCase());
    return `<img src="${src}" alt="${title}" title="${title}" onerror="this.style.display='none'">`;
  }

  function updatePlayerCountBadge() {
    const badge = document.getElementById('playerCountBadge');
    if (!badge) return;
    const count = players.length;
    badge.textContent = `${fmtInt(count)} ${count === 1 ? 'Player' : 'Players'}`;
  }

  function fmtDuration(ms) {
    const round = (n) => Math.round(n * 10) / 10;
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (ms >= 3600000) return plural(round(ms / 3600000), 'hour');
    if (ms >= 60000) return plural(round(ms / 60000), 'minute');
    return plural(round(ms / 1000), 'second');
  }

  function fmtRemaining(ms) {
    if (ms >= 3600000) return `${Math.ceil(ms / 3600000)}h`;
    if (ms >= 60000) return `${Math.ceil(ms / 60000)}m`;
    return `${Math.max(1, Math.ceil(ms / 1000))}s`;
  }

  function renderPageSizeButtons() {
    const el = document.getElementById('pageSizeButtons');
    if (!el) return;
    el.innerHTML = allowedPageSizes.map((size) =>
      `<button class="pagesize-btn ${size === pageSize ? 'active' : ''}" data-size="${size}">${size}</button>`
    ).join('');
  }

  function renderLimitsNote() {
    const el = document.getElementById('limitsNote');
    if (!el) return;
    el.textContent =
      `To reduce server load, updating an existing player profile is limited to once every ${fmtDuration(refreshCooldownMs)}, ` +
      `and registering a new player is limited to once every ${fmtDuration(newPlayerCooldownMs)}.`;
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (Number.isFinite(cfg.refresh_cooldown_ms)) refreshCooldownMs = cfg.refresh_cooldown_ms;
    if (Number.isFinite(cfg.new_player_cooldown_ms)) newPlayerCooldownMs = cfg.new_player_cooldown_ms;
    if (Number.isFinite(cfg.max_display)) maxDisplay = cfg.max_display;
    if (Array.isArray(cfg.page_size_options)) {
      const sizes = cfg.page_size_options.map(Number).filter((n) => n > 0);
      if (sizes.length) allowedPageSizes = sizes;
    }
    if (allowedPageSizes.includes(savedPageSize)) pageSize = savedPageSize;
    else if (!allowedPageSizes.includes(pageSize)) pageSize = allowedPageSizes[0];
    renderPageSizeButtons();
    renderLimitsNote();
  }

  async function loadLeaderboard() {
    boardBody.innerHTML = `<tr><td colspan="14" class="loading">Loading...</td></tr>`;
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      players = data.players || [];
      applyConfig(data.config);
      updatePlayerCountBadge();
      currentPage = 0;
      render();
      hideStatus();
    } catch (err) {
      boardBody.innerHTML = `<tr><td colspan="14" class="empty">Failed to load leaderboard data.</td></tr>`;
    }
  }

  // ---- Avg Speed: deviation from the median ----
  // Median of Avg Speed (km/h) over all players that have data in the current mode.
  let speedMedian = 0;

  function updateSpeedMedian() {
    const vals = players
      .map((r) => r.modes[mode].avg_speed_kmh)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (!vals.length) { speedMedian = 0; return; }
    const mid = Math.floor(vals.length / 2);
    speedMedian = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  // Signed difference from the median in percent, or null when there is no data.
  function speedDiffPct(kmh) {
    if (!kmh || !speedMedian) return null;
    return ((kmh - speedMedian) / speedMedian) * 100;
  }

  function getSortValue(row, key) {
    const m = row.modes[mode];
    switch (key) {
      case 'rank': return row.rank;
      case 'country': return row.country_code || '';
      case 'name': return row.name.toLowerCase();
      case 'distance': return m.distance_km;
      case 'jobs': return m.jobs;
      case 'mass': return m.mass_t;
      case 'time': return m.time_min;
      case 'avgDistance': return m.avg_distance_km;
      case 'avgSpeed': {
        // Sorted by |difference from median|; null = no data (always placed last)
        const d = speedDiffPct(m.avg_speed_kmh);
        return d === null ? null : Math.abs(d);
      }
      case 'difficultP': return m.difficult_p;
      case 'easyP': return m.easy_p;
      case 'lastUpdated': return row.last_updated;
      default: return 0;
    }
  }

  function isDefaultSort() {
    return sortKeys.length === 1 && sortKeys[0].key === 'distance' && sortKeys[0].dir === 'desc';
  }

  // Region acts as a "group by": when it is in the sort list it is always applied
  // first, so every region forms a block and the other keys sort inside each block.
  function effectiveSortKeys() {
    const ci = sortKeys.findIndex((s) => s.key === 'country');
    if (ci <= 0) return sortKeys;
    return [sortKeys[ci], ...sortKeys.filter((_, i) => i !== ci)];
  }

  // Returns 0 when equal; null values (no data) always go last regardless of direction.
  function compareByKey(a, b, { key, dir }) {
    const va = getSortValue(a, key);
    const vb = getSortValue(b, key);
    if (va === null || vb === null) {
      if (va === vb) return 0;
      return va === null ? 1 : -1;
    }
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  }

  function sortedPlayers() {
    updateSpeedMedian();
    const copy = [...players];
    const vKey = rankValueKey();
    const keys = effectiveSortKeys();
    const hasRegion = keys[0].key === 'country';
    const restKeys = hasRegion ? keys.slice(1) : keys;
    copy.sort((a, b) => {
      // 1) rows that would show "N/A" always go below the lowest rank
      //    (never hidden; listed after every ranked row, in both directions)
      const naA = isNaRow(a, vKey);
      const naB = isNaRow(b, vKey);
      if (naA !== naB) return naA ? 1 : -1;
      // 2) region grouping (if any)
      if (hasRegion) {
        const c = compareByKey(a, b, keys[0]);
        if (c !== 0) return c;
      }
      // 3) remaining keys in priority order
      for (const k of restKeys) {
        const c = compareByKey(a, b, k);
        if (c !== 0) return c;
      }
      // 4) final tie-break: Total Distance (desc) of the current mode
      return b.modes[mode].distance_km - a.modes[mode].distance_km;
    });
    return copy;
  }

  function matchesSearch(row) {
    if (!searchQuery) return true;
    const q = searchQuery;
    const name = (row.name || '').toLowerCase();
    const countryName = (row.country_name || '').toLowerCase();
    const countryCode = (row.country_code || '').toLowerCase();
    const playerId = String(row.id);
    return (
      name.includes(q) ||
      countryName.includes(q) ||
      countryCode.includes(q) ||
      playerId.includes(q)
    );
  }

  function visibleRows() {
    const filtered = sortedPlayers().filter(matchesSearch);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (currentPage > totalPages - 1) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;

    const start = currentPage * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    const resultCount = document.getElementById('resultCount');
    if (resultCount) {
      resultCount.textContent = filtered.length
        ? `Showing ${start + 1}-${start + pageRows.length} of ${filtered.length}`
        : '';
    }
    renderPagination(totalPages, filtered.length);
    return pageRows;
  }

  function renderPagination(totalPages, totalCount) {
    if (totalCount === 0) {
      ['paginationTop', 'paginationBottom'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
      });
      return;
    }

    const html = `
      <button class="page-nav" data-page="prev" ${currentPage === 0 ? 'disabled' : ''}>‹ Prev</button>
      <div class="page-numbers">${pageNumberButtonsHtml(totalPages)}</div>
      <button class="page-nav" data-page="next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next ›</button>
    `;
    ['paginationTop', 'paginationBottom'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  }

  function pageNumberButtonsHtml(totalPages) {
    let html = '';
    for (let p = 0; p < totalPages; p++) {
      html += `<button class="page-num ${p === currentPage ? 'active' : ''}" data-page="${p}">${p + 1}</button>`;
    }
    return html;
  }

  // ---- displayed rank ----
  // Keys that have no "rank within the key": the displayed rank falls back to
  // Total Distance of the current mode (same as the original rank in GLOBAL mode).
  const NON_RANKABLE_KEYS = new Set(['rank', 'name', 'lastUpdated', 'avgSpeed']);
  // Keys whose cell shows "-" when the value is 0 (=> rank is N/A).
  const DASH_KEYS = new Set(['distance', 'mass', 'time', 'avgDistance', 'avgSpeed']);
  const DASH_FIELDS = {
    distance: 'distance_km',
    mass: 'mass_t',
    time: 'time_min',
    avgDistance: 'avg_distance_km',
    avgSpeed: 'avg_speed_kmh',
  };

  // The column whose values the displayed rank is based on.
  // The first sort key (in click order) that can be ranked; Region only groups.
  function rankValueKey() {
    const k = sortKeys.find((s) => s.key !== 'country' && !NON_RANKABLE_KEYS.has(s.key));
    return k ? k.key : 'distance';
  }

  // True when the row's rank is "N/A" for the given value key in the current mode.
  function isNaRow(row, valueKey) {
    const m = row.modes[mode];
    if (!m.distance_km) return true;                                   // no Total Distance => N/A
    const field = DASH_FIELDS[valueKey];
    return Boolean(field) && !m[field];                                  // cell would show "-"
  }

  /**
   * Returns { showOrig, ranks, sizes }.
   *  - showOrig=false: just show row.rank (original Global Total Distance rank), as before.
   *  - showOrig=true : `ranks` maps player id -> rank (or null = N/A) within the current
   *    sort key / mode (/ region when sorting by Region); the original rank is shown small.
   * Ranks are computed over ALL players (not just the search-filtered ones);
   * 1 = highest value, ties share the same rank.
   */
  function computeDisplayRanks() {
    const isRegion = sortKeys.some((s) => s.key === 'country');
    const valueKey = rankValueKey();
    const showOrig = !(mode === 'global' && valueKey === 'distance' && !isRegion);
    if (!showOrig) return { showOrig: false, ranks: null, sizes: null };

    const ranks = new Map();
    const sizes = new Map();   // groupId -> number of ranked players (Region sort only)
    const groups = new Map();
    for (const row of players) {
      const v = getSortValue(row, valueKey);
      if (isNaRow(row, valueKey)) {
        ranks.set(row.id, null);
        continue;
      }
      const groupId = isRegion ? (row.country_code || '') : '';
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push({ id: row.id, v });
    }
    groups.forEach((arr, groupId) => {
      sizes.set(groupId, arr.length);
      arr.sort((x, y) => y.v - x.v);
      let prevV = null;
      let prevRank = 0;
      arr.forEach((e, i) => {
        const r = e.v === prevV ? prevRank : i + 1;
        ranks.set(e.id, r);
        prevV = e.v;
        prevRank = r;
      });
    });
    return { showOrig: true, ranks, sizes: isRegion ? sizes : null };
  }

  function rankCellHtml(row, showOrig, ranks, sizes) {
    if (!showOrig) return String(row.rank);
    const orig = `<span class="rank-orig" title="Original rank (Global Total Distance)">#${row.rank}</span>`;
    const r = ranks.get(row.id);
    let main;
    if (r == null) {
      main = '<span class="rank-main rank-na">N/A</span>';
    } else if (sizes) {
      const size = sizes.get(row.country_code || '');
      main = `<span class="rank-main rank-wide">${r}/${size}</span>`;
    } else {
      main = `<span class="rank-main">${r}</span>`;
    }
    return `${orig}${main}`;
  }

  function canRefreshNow(row) {
    return Date.now() - row.last_updated >= refreshCooldownMs;
  }

  function nextRefreshLabel(row) {
    const remain = refreshCooldownMs - (Date.now() - row.last_updated);
    return `In ~${fmtRemaining(remain)}`;
  }

  function render() {
    const rows = visibleRows();
    if (rows.length === 0) {
      const msg = players.length === 0
        ? 'No players registered yet. Register a World of Trucks Profile ID using the form above.'
        : `No players match "${escapeHtml(searchQuery)}".`;
      boardBody.innerHTML = `<tr><td colspan="14" class="empty">${msg}</td></tr>`;
      updateSortHeaders();
      return;
    }

    const { showOrig, ranks, sizes } = computeDisplayRanks();

    boardBody.innerHTML = rows.map((row) => {
      const m = row.modes[mode];
      const refreshable = canRefreshNow(row);
      const nd = !m.distance_km;   // no Total Distance in this mode => all values "-"
      return `
        <tr data-id="${row.id}">
          <td class="rank num">${rankCellHtml(row, showOrig, ranks, sizes)}</td>
          <td class="flag region-col">${flagImg(row)}</td>
          <td class="name"><a href="https://www.worldoftrucks.com/en/profile/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a></td>
          <td class="num">${fmtDistance(m.distance_km)}</td>
          <td class="num">${nd ? '-' : fmtMass(m.mass_t)}</td>
          <td class="num">${nd ? '-' : fmtTime(m.time_min)}</td>
          <td class="num">${nd ? '-' : fmtDistance1dp(m.avg_distance_km)}</td>
          <td class="num">${nd ? '-' : fmtSpeed(m.avg_speed_kmh)}</td>
          <td class="num"${!nd && m.avg_speed_kmh && speedMedian ? ` title="Median: ${fmtSpeed(speedMedian)}"` : ''}>${nd ? '-' : fmtSpeedDiff(m.avg_speed_kmh)}</td>
          <td class="num">${nd ? '-' : fmtInt(m.difficult_p)}</td>
          <td class="num">${nd ? '-' : fmtInt(m.easy_p)}</td>
          <td class="num">${nd ? '-' : fmtInt(m.jobs)}</td>
          <td class="num" title="${new Date(row.last_updated).toLocaleString('en-US')}">${fmtAgo(row.last_updated)}</td>
          <td>
            <button class="update-btn" data-refresh="${row.id}" ${refreshable ? '' : 'disabled title="' + nextRefreshLabel(row) + '"'}>
              ⟳ ${refreshable ? 'Refresh' : nextRefreshLabel(row)}
            </button>
          </td>
        </tr>`;
    }).join('');

    updateSortHeaders();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function headerLabel(key) {
    const th = document.querySelector(`th.sortable[data-key="${key}"]`);
    return th ? th.textContent.trim() : key;
  }

  function updateSortHeaders() {
    document.querySelectorAll('th.sortable').forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      th.removeAttribute('data-order');
      const key = th.dataset.key === 'avgSpeedDiff' ? 'avgSpeed' : th.dataset.key;
      const idx = sortKeys.findIndex((s) => s.key === key);
      if (idx >= 0) {
        th.classList.add(sortKeys[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (sortKeys.length > 1) th.setAttribute('data-order', String(idx + 1));
      }
    });

    const resetBtn = document.getElementById('resetSortBtn');
    if (resetBtn) resetBtn.disabled = isDefaultSort();
    const summary = document.getElementById('sortSummary');
    if (summary) {
      summary.textContent = 'Sort: ' + sortKeys
        .map((s) => `${headerLabel(s.key)} ${s.dir === 'asc' ? '▲' : '▼'}`)
        .join(' → ');
    }
  }

  // ---- events ----
  // Click: toggle direction if the column is already a sort key,
  // otherwise append it as the next (lower-priority) key.
  // Exception: from the pristine default sort (Total Distance only) the first click replaces it.
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      // The "Speed vs Median" header is linked to "Avg Speed": both use the same sort key.
      const key = th.dataset.key === 'avgSpeedDiff' ? 'avgSpeed' : th.dataset.key;
      const idx = sortKeys.findIndex((s) => s.key === key);
      const firstDir = (key === 'rank' || key === 'avgSpeed') ? 'asc' : 'desc';
      if (idx >= 0) {
        sortKeys[idx].dir = sortKeys[idx].dir === 'asc' ? 'desc' : 'asc';
      } else if (isDefaultSort()) {
        sortKeys = [{ key, dir: firstDir }];
      } else {
        sortKeys.push({ key, dir: firstDir });
      }
      currentPage = 0;
      render();
    });
  });

  document.getElementById('resetSortBtn').addEventListener('click', () => {
    sortKeys = DEFAULT_SORT();
    currentPage = 0;
    render();
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      render();
    });
  });

  document.querySelectorAll('.unit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.unit-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      unit = btn.dataset.unit;
      setCookie('wot_unit', unit);
      render();
    });
  });

  document.getElementById('pageSizeButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.pagesize-btn');
    if (!btn) return;
    pageSize = Number(btn.dataset.size) || allowedPageSizes[0];
    currentPage = 0;
    setCookie('wot_pageSize', pageSize);
    renderPageSizeButtons();
    render();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    currentPage = 0;
    render();
  });

  ['paginationTop', 'paginationBottom'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.page === 'prev') currentPage -= 1;
      else if (btn.dataset.page === 'next') currentPage += 1;
      else currentPage = Number(btn.dataset.page);
      render();
      // Keep the top of the table in view when paging from the bottom control.
      if (id === 'paginationBottom') {
        document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.getElementById('reloadBtn').addEventListener('click', loadLeaderboard);

  document.getElementById('addPlayerBtn').addEventListener('click', async () => {
    const input = document.getElementById('newPlayerId');
    const id = Number(input.value);
    if (!id || id <= 0) {
      showStatus('Please enter a valid Profile ID.', 'error');
      return;
    }
    const btn = document.getElementById('addPlayerBtn');
    btn.disabled = true;
    showStatus(`Fetching Profile ID ${id}...`);
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        showStatus(data.error || 'Failed to register player.', 'error');
      } else if (data.code === 'RANK_TOO_LOW') {
        // 既存プレイヤーを更新した結果、圏外になって削除されたケース
        showStatus(data.message, 'error');
        input.value = '';
        await loadLeaderboard();
      } else if (data.refreshed) {
        showStatus(`${data.name} is already registered, so their stats were updated.`, 'success');
        input.value = '';
        await loadLeaderboard();
      } else {
        showStatus(`Registered ${data.name}. They will appear on the leaderboard if ranked in the top ${fmtInt(maxDisplay)}.`, 'success');
        input.value = '';
        await loadLeaderboard();
      }
    } catch (err) {
      showStatus('A network error occurred.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  boardBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-refresh]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.refresh;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '⟳ Updating...';
    try {
      const res = await fetch(`/api/players/${id}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showStatus(data.error || 'Failed to update stats.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      } else if (data.code === 'RANK_TOO_LOW') {
        showStatus(data.message, 'error');
        await loadLeaderboard();
      } else {
        showStatus(`Updated stats for ${data.name}.`, 'success');
        await loadLeaderboard();
      }
    } catch (err) {
      showStatus('A network error occurred.', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Reflect restored preferences (from cookies) on the toggle buttons themselves.
  document.querySelectorAll('.unit-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.unit === unit);
  });
  renderPageSizeButtons();
  renderLimitsNote();

  loadLeaderboard();
})();