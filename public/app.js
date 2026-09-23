(() => {
  const KM_PER_MILE = 1.609344;
  const REFRESH_COOLDOWN_MS = 8 * 60 * 60 * 1000;
  const COOKIE_MAX_AGE_DAYS = 365;
  const ALLOWED_PAGE_SIZES = [100, 200, 250, 500, 1000];

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
  let sortKey = 'distance';
  let sortDir = 'desc';
  let pageSize = 100;        // 100 | 200 | 250 | 500 | 1000
  let searchQuery = '';      // matches against player name / country name / country code
  let currentPage = 0;       // 0-indexed

  // Restore persisted preferences (Distance Unit / page size) from cookies.
  const savedUnit = getCookie('wot_unit');
  if (savedUnit === 'km' || savedUnit === 'mi') unit = savedUnit;

  const savedPageSize = Number(getCookie('wot_pageSize'));
  if (ALLOWED_PAGE_SIZES.includes(savedPageSize)) pageSize = savedPageSize;


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

  async function loadLeaderboard() {
    boardBody.innerHTML = `<tr><td colspan="13" class="loading">Loading...</td></tr>`;
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      players = data.players || [];
      currentPage = 0;
      render();
      hideStatus();
    } catch (err) {
      boardBody.innerHTML = `<tr><td colspan="13" class="empty">Failed to load leaderboard data.</td></tr>`;
    }
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
      case 'avgSpeed': return m.avg_speed_kmh;
      case 'difficultP': return m.difficult_p;
      case 'easyP': return m.easy_p;
      case 'lastUpdated': return row.last_updated;
      default: return 0;
    }
  }

  function sortedPlayers() {
    const copy = [...players];
    copy.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      let cmp;
      if (typeof va === 'string') cmp = va.localeCompare(vb);
      else cmp = va - vb;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }

  function matchesSearch(row) {
    if (!searchQuery) return true;
    const q = searchQuery;
    const name = (row.name || '').toLowerCase();
    const countryName = (row.country_name || '').toLowerCase();
    const countryCode = (row.country_code || '').toLowerCase();
    return name.includes(q) || countryName.includes(q) || countryCode.includes(q);
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

  function canRefreshNow(row) {
    return Date.now() - row.last_updated >= REFRESH_COOLDOWN_MS;
  }

  function nextRefreshLabel(row) {
    const remain = REFRESH_COOLDOWN_MS - (Date.now() - row.last_updated);
    const hrs = Math.ceil(remain / 3600000);
    return `In ~${hrs}h`;
  }

  function render() {
    const rows = visibleRows();
    if (rows.length === 0) {
      const msg = players.length === 0
        ? 'No players registered yet. Register a World of Trucks Profile ID using the form above.'
        : `No players match "${escapeHtml(searchQuery)}".`;
      boardBody.innerHTML = `<tr><td colspan="13" class="empty">${msg}</td></tr>`;
      updateSortHeaders();
      return;
    }

    boardBody.innerHTML = rows.map((row) => {
      const m = row.modes[mode];
      const refreshable = canRefreshNow(row);
      return `
        <tr data-id="${row.id}">
          <td class="rank num">${row.rank}</td>
          <td class="flag region-col">${flagImg(row)}</td>
          <td class="name"><a href="https://www.worldoftrucks.com/en/profile/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a></td>
          <td class="num">${fmtDistance(m.distance_km)}</td>
          <td class="num">${fmtMass(m.mass_t)}</td>
          <td class="num">${fmtTime(m.time_min)}</td>
          <td class="num">${fmtDistance1dp(m.avg_distance_km)}</td>
          <td class="num">${fmtSpeed(m.avg_speed_kmh)}</td>
          <td class="num">${fmtInt(m.difficult_p)}</td>
          <td class="num">${fmtInt(m.easy_p)}</td>
          <td class="num">${fmtInt(m.jobs)}</td>
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

  function updateSortHeaders() {
    document.querySelectorAll('th.sortable').forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.key === sortKey) {
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  // ---- events ----
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = key === 'rank' ? 'asc' : 'desc';
      }
      currentPage = 0;
      render();
    });
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

  document.querySelectorAll('.pagesize-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pagesize-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      pageSize = Number(btn.dataset.size) || 100;
      currentPage = 0;
      setCookie('wot_pageSize', pageSize);
      render();
    });
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
      } else {
        showStatus(`Registered ${data.name}. They will appear on the leaderboard if ranked in the top 1,000.`, 'success');
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
  document.querySelectorAll('.pagesize-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.size) === pageSize);
  });

  loadLeaderboard();
})();