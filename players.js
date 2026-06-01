// ─── Player Selection Sheet ───────────────────────────────────────────────
// Shared across all scorer pages. Call initPlayerSheet() after match loads.

const PLAYERS_SB_URL = 'https://izutkprvzuwrxudqvnin.supabase.co';
const PLAYERS_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dXRrcHJ2enV3cnh1ZHF2bmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NzYxNjUsImV4cCI6MjA5NTQ1MjE2NX0.MK80nCRgep3h8BpOt-Zy4EbizrXgndLD1XQCJJHIUCU';

async function playersFetch(path, options = {}) {
    const { method = 'GET', body, extraHeaders = {} } = options;
    const res = await fetch(`${PLAYERS_SB_URL}/rest/v1/${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'apikey': PLAYERS_SB_KEY,
            'Authorization': `Bearer ${PLAYERS_SB_KEY}`,
            ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (method === 'POST' || method === 'DELETE' || method === 'PATCH') return null;
    return res.json();
}

let _psMatchId = null;
let _psTeamA = null;
let _psTeamB = null;
let _psScorerId = null;
let _psPlayers = { a: [], b: [] };       // full roster
let _psSelected = new Set();              // player_ids selected for this match
let _psEditing = null;                    // player_id being edited
let _psActiveTab = 'a';

function initPlayerSheet(matchId, teamA, teamB, scorerId) {
    _psMatchId  = matchId;
    _psTeamA    = teamA;
    _psTeamB    = teamB;
    _psScorerId = scorerId;

    // Inject CSS once
    if (!document.getElementById('ps-style')) {
        const style = document.createElement('style');
        style.id = 'ps-style';
        style.textContent = `
            .ps-fab {
                position: fixed; bottom: 88px; right: 20px;
                width: 52px; height: 52px; border-radius: 50%;
                background: #1a73e8; color: white; border: none;
                font-size: 22px; cursor: pointer; z-index: 200;
                box-shadow: 0 4px 12px rgba(26,115,232,0.4);
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            .ps-fab:hover { background: #1557b0; transform: scale(1.05); }

            .ps-overlay {
                display: none; position: fixed; inset: 0;
                background: rgba(0,0,0,0.5); z-index: 300;
                align-items: flex-end; justify-content: center;
            }
            .ps-overlay.open { display: flex; }

            .ps-sheet {
                background: white; border-radius: 20px 20px 0 0;
                width: 100%; max-height: 85vh;
                display: flex; flex-direction: column;
                animation: psSlideUp 0.3s ease;
            }
            @keyframes psSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

            .ps-handle { width: 40px; height: 4px; background: #e0e0e0; border-radius: 2px; margin: 12px auto 0; flex-shrink: 0; }

            .ps-header { padding: 14px 20px 0; flex-shrink: 0; }
            .ps-title { font-size: 17px; font-weight: 700; color: #202124; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
            .ps-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #5f6368; padding: 0; }

            .ps-tabs { display: flex; background: #f1f3f4; border-radius: 10px; padding: 3px; margin-bottom: 12px; }
            .ps-tab { flex: 1; padding: 8px; text-align: center; font-size: 13px; font-weight: 600; color: #5f6368; border-radius: 8px; cursor: pointer; transition: all 0.2s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ps-tab.active { background: white; color: #1a73e8; box-shadow: 0 1px 4px rgba(0,0,0,0.12); }

            .ps-count { font-size: 12px; color: #9e9e9e; margin-bottom: 8px; }

            .ps-list { overflow-y: auto; flex: 1; padding: 0 16px 24px; }

            .ps-player {
                display: flex; align-items: center; gap: 12px;
                padding: 11px 12px; border-radius: 10px;
                margin-bottom: 6px; border: 1.5px solid #f0f0f0;
                background: white; transition: all 0.2s;
            }
            .ps-player.selected { border-color: #1a73e8; background: #f0f6ff; }

            .ps-checkbox {
                width: 22px; height: 22px; border-radius: 6px;
                border: 2px solid #e0e0e0; display: flex;
                align-items: center; justify-content: center;
                cursor: pointer; flex-shrink: 0; transition: all 0.2s;
            }
            .ps-player.selected .ps-checkbox { background: #1a73e8; border-color: #1a73e8; color: white; font-size: 13px; }

            .ps-info { flex: 1; min-width: 0; }
            .ps-name { font-size: 14px; font-weight: 500; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ps-captain { display: inline-block; font-size: 10px; font-weight: 700; background: #fff3cd; color: #856404; padding: 1px 6px; border-radius: 6px; margin-left: 6px; }

            .ps-edit-btn { background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px; color: #9e9e9e; flex-shrink: 0; }
            .ps-edit-btn:hover { color: #1a73e8; }

            .ps-edit-row { display: flex; gap: 8px; width: 100%; margin-top: 4px; }
            .ps-edit-input { flex: 1; padding: 6px 10px; border: 1.5px solid #1a73e8; border-radius: 8px; font-size: 14px; outline: none; }
            .ps-save-btn { padding: 6px 14px; background: #1a73e8; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
            .ps-cancel-btn { padding: 6px 10px; background: #f5f5f5; color: #5f6368; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; }

            .ps-save-all {
                margin: 10px 16px 0; padding: 14px;
                background: #1a73e8; color: white; border: none;
                border-radius: 12px; font-size: 15px; font-weight: 700;
                cursor: pointer; width: calc(100% - 32px); flex-shrink: 0;
                transition: all 0.2s;
            }
            .ps-save-all:hover { background: #1557b0; }
        `;
        document.head.appendChild(style);
    }

    // Inject HTML once
    if (!document.getElementById('ps-overlay')) {
        document.body.insertAdjacentHTML('beforeend', `
            <button class="ps-fab" onclick="openPlayerSheet()" title="Team Players">👥</button>
            <div class="ps-overlay" id="ps-overlay" onclick="handlePsOverlayClick(event)">
                <div class="ps-sheet">
                    <div class="ps-handle"></div>
                    <div class="ps-header">
                        <div class="ps-title">
                            <span>Team Players</span>
                            <button class="ps-close" onclick="closePlayerSheet()">×</button>
                        </div>
                        <div class="ps-tabs">
                            <div class="ps-tab active" id="ps-tab-a" onclick="switchPsTab('a')"></div>
                            <div class="ps-tab" id="ps-tab-b" onclick="switchPsTab('b')"></div>
                        </div>
                        <div class="ps-count" id="ps-count"></div>
                    </div>
                    <div class="ps-list" id="ps-list"></div>
                    <button class="ps-save-all" onclick="saveMatchPlayers()">Save Selection</button>
                </div>
            </div>
        `);
    }

    // Set tab names
    document.getElementById('ps-tab-a').textContent = teamA.name;
    document.getElementById('ps-tab-b').textContent = teamB.name;
}

function handlePsOverlayClick(e) {
    if (e.target === document.getElementById('ps-overlay')) closePlayerSheet();
}

async function openPlayerSheet() {
    document.getElementById('ps-overlay').classList.add('open');
    await loadPlayers();
}

function closePlayerSheet() {
    document.getElementById('ps-overlay').classList.remove('open');
    _psEditing = null;
}

async function loadPlayers() {
    try {
        const [playersA, playersB, existing] = await Promise.all([
            playersFetch(`players?team_id=eq.${_psTeamA.id}&order=is_captain.desc,player_name.asc&select=player_id,player_name,is_captain`),
            playersFetch(`players?team_id=eq.${_psTeamB.id}&order=is_captain.desc,player_name.asc&select=player_id,player_name,is_captain`),
            playersFetch(`match_players?match_id=eq.${_psMatchId}&select=player_id`)
        ]);
        _psPlayers.a = playersA || [];
        _psPlayers.b = playersB || [];
        _psSelected = new Set((existing || []).map(p => p.player_id));
        renderPsList();
    } catch(e) {
        console.error('Failed to load players:', e);
    }
}

function switchPsTab(tab) {
    _psActiveTab = tab;
    _psEditing = null;
    document.getElementById('ps-tab-a').classList.toggle('active', tab === 'a');
    document.getElementById('ps-tab-b').classList.toggle('active', tab === 'b');
    renderPsList();
}

function renderPsList() {
    const players = _psPlayers[_psActiveTab];
    const teamId  = _psActiveTab === 'a' ? _psTeamA.id : _psTeamB.id;
    const sel     = players.filter(p => _psSelected.has(p.player_id)).length;

    document.getElementById('ps-count').textContent =
        `${sel} of ${players.length} selected`;

    document.getElementById('ps-list').innerHTML = players.map(p => {
        const isSelected = _psSelected.has(p.player_id);
        const isEditing  = _psEditing === p.player_id;
        const capBadge   = p.is_captain ? '<span class="ps-captain">C</span>' : '';

        const editRow = isEditing ? `
            <div class="ps-edit-row">
                <input class="ps-edit-input" id="ps-input-${p.player_id}"
                       value="${p.player_name.replace(/"/g,'&quot;')}"
                       onkeydown="if(event.key==='Enter')saveName('${p.player_id}','${_psActiveTab}')">
                <button class="ps-save-btn" onclick="saveName('${p.player_id}','${_psActiveTab}')">Save</button>
                <button class="ps-cancel-btn" onclick="cancelEdit()">✕</button>
            </div>` : '';

        return `
            <div class="ps-player ${isSelected ? 'selected' : ''}" id="ps-row-${p.player_id}">
                <div class="ps-checkbox" onclick="togglePlayer('${p.player_id}')">
                    ${isSelected ? '✓' : ''}
                </div>
                <div class="ps-info" onclick="togglePlayer('${p.player_id}')">
                    <div class="ps-name">${p.player_name}${capBadge}</div>
                    ${editRow}
                </div>
                <button class="ps-edit-btn" onclick="startEdit('${p.player_id}')">✏️</button>
            </div>`;
    }).join('');

    // Focus edit input if editing
    if (_psEditing) {
        setTimeout(() => {
            const input = document.getElementById(`ps-input-${_psEditing}`);
            if (input) { input.focus(); input.select(); }
        }, 50);
    }
}

function togglePlayer(playerId) {
    if (_psSelected.has(playerId)) {
        _psSelected.delete(playerId);
    } else {
        _psSelected.add(playerId);
    }
    renderPsList();
}

function startEdit(playerId) {
    _psEditing = playerId;
    renderPsList();
}

function cancelEdit() {
    _psEditing = null;
    renderPsList();
}

async function saveName(playerId, tab) {
    const input = document.getElementById(`ps-input-${playerId}`);
    if (!input) return;
    const newName = input.value.trim();
    if (!newName) return;

    try {
        await playersFetch(`players?player_id=eq.${playerId}`, {
            method: 'PATCH',
            extraHeaders: { 'Prefer': 'return=minimal' },
            body: { player_name: newName }
        });
        // Update local state
        const p = _psPlayers[tab].find(p => p.player_id === playerId);
        if (p) p.player_name = newName;
        _psEditing = null;
        renderPsList();
    } catch(e) {
        alert('Failed to save name: ' + e.message);
    }
}

async function saveMatchPlayers() {
    try {
        const btn = document.querySelector('.ps-save-all');
        btn.textContent = 'Saving...';
        btn.disabled = true;

        // Get team IDs for selected players
        const allPlayers = [..._psPlayers.a, ..._psPlayers.b];
        const playerTeamMap = {};
        _psPlayers.a.forEach(p => playerTeamMap[p.player_id] = _psTeamA.id);
        _psPlayers.b.forEach(p => playerTeamMap[p.player_id] = _psTeamB.id);

        // Delete existing selections for this match
        await playersFetch(`match_players?match_id=eq.${_psMatchId}`, {
            method: 'DELETE',
            extraHeaders: { 'Prefer': 'return=minimal' }
        });

        // Insert new selections
        if (_psSelected.size > 0) {
            const rows = [..._psSelected].map(pid => ({
                match_id:   _psMatchId,
                player_id:  pid,
                team_id:    playerTeamMap[pid],
                scorer_id:  _psScorerId || null
            }));

            await playersFetch('match_players', {
                method: 'POST',
                extraHeaders: { 'Prefer': 'return=minimal' },
                body: rows
            });
        }

        btn.textContent = '✓ Saved!';
        btn.style.background = '#34a853';
        setTimeout(() => {
            btn.textContent = 'Save Selection';
            btn.style.background = '';
            btn.disabled = false;
            closePlayerSheet();
        }, 1200);
    } catch(e) {
        alert('Failed to save: ' + e.message);
        document.querySelector('.ps-save-all').textContent = 'Save Selection';
        document.querySelector('.ps-save-all').disabled = false;
    }
}
