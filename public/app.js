(() => {
  const KM_PER_MILE = 1.609344;
  const REFRESH_COOLDOWN_MS = 8 * 60 * 60 * 1000;

  let players = [];          // raw data from /api/leaderboard (fixed global-distance order + rank)
  let mode = 'global';       // global | euro | american
  let unit = 'km';           // km | mi
  let sortKey = 'rank';
  let sortDir = 'asc';

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
    return `${val.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`;
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
    boardBody.innerHTML = `<tr><td colspan="11" class="loading">Loading...</td></tr>`;
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      players = data.players || [];
      render();
      hideStatus();
    } catch (err) {
      boardBody.innerHTML = `<tr><td colspan="11" class="empty">Failed to load leaderboard data.</td></tr>`;
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

  function canRefreshNow(row) {
    return Date.now() - row.last_updated >= REFRESH_COOLDOWN_MS;
  }

  function nextRefreshLabel(row) {
    const remain = REFRESH_COOLDOWN_MS - (Date.now() - row.last_updated);
    const hrs = Math.ceil(remain / 3600000);
    return `In ~${hrs}h`;
  }

  function render() {
    const rows = sortedPlayers();
    if (rows.length === 0) {
      boardBody.innerHTML = `<tr><td colspan="11" class="empty">No players registered yet. Register a World of Trucks Profile ID using the form above.</td></tr>`;
      updateSortHeaders();
      return;
    }

    boardBody.innerHTML = rows.map((row) => {
      const m = row.modes[mode];
      const refreshable = canRefreshNow(row);
      return `
        <tr data-id="${row.id}">
          <td class="rank">${row.rank}</td>
          <td class="flag">${flagImg(row)}</td>
          <td class="name"><a href="https://www.worldoftrucks.com/en/profile/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a></td>
          <td>${fmtDistance(m.distance_km)}</td>
          <td>${fmtInt(m.jobs)}</td>
          <td>${fmtMass(m.mass_t)}</td>
          <td>${fmtTime(m.time_min)}</td>
          <td>${fmtDistance1dp(m.avg_distance_km)}</td>
          <td>${fmtSpeed(m.avg_speed_kmh)}</td>
          <td title="${new Date(row.last_updated).toLocaleString('en-US')}">${fmtAgo(row.last_updated)}</td>
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
      render();
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

  loadLeaderboard();
})();