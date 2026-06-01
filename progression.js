// ─── Auto-Progression Engine ─────────────────────────────────────────────────
// Handles both 1-entry (pool=null) and 2-entry (pool='A' or 'B') tournaments

const PROG_URL = 'https://izutkprvzuwrxudqvnin.supabase.co';
const PROG_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dXRrcHJ2enV3cnh1ZHF2bmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NzYxNjUsImV4cCI6MjA5NTQ1MjE2NX0.MK80nCRgep3h8BpOt-Zy4EbizrXgndLD1XQCJJHIUCU';

async function progFetch(path, options = {}) {
    const { body, method = 'GET', extraHeaders = {} } = options;
    const res = await fetch(`${PROG_URL}/rest/v1/${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'apikey': PROG_KEY,
            'Authorization': `Bearer ${PROG_KEY}`,
            'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
            ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json().catch(() => null);
}

// ─── GS1 → GS2 mapping ───────────────────────────────────────────────────────
const GS1_TO_GS2 = {
    'M1':  { sibling: 'M2',  next: 'M11' },
    'M2':  { sibling: 'M1',  next: 'M11' },
    'M3':  { sibling: 'M4',  next: 'M12' },
    'M4':  { sibling: 'M3',  next: 'M12' },
    'M5':  { sibling: 'M6',  next: 'M13' },
    'M6':  { sibling: 'M5',  next: 'M13' },
    'M7':  { sibling: 'M8',  next: 'M14' },
    'M8':  { sibling: 'M7',  next: 'M14' },
    'M9':  { sibling: 'M10', next: 'M15' },
    'M10': { sibling: 'M9',  next: 'M15' },
};

const GS2_TO_QF = {
    'M11': { sibling: 'M12', next: 'M16' },
    'M12': { sibling: 'M11', next: 'M16' },
    'M13': { sibling: 'M14', next: 'M17' },
    'M14': { sibling: 'M13', next: 'M17' },
    'M15': { walkover: true, next: 'M18' },
};

// ─── Main entry ──────────────────────────────────────────────────────────────
async function runProgression(completedMatchId, winnerId, scorerId) {
    try {
        const matches = await progFetch(`matches?match_id=eq.${completedMatchId}&select=*`);
        if (!matches?.length) return;
        const m = matches[0];
        const pool = m.pool || null;
        console.log(`Progression: ${m.match_number} (${m.round}) pool=${pool} winner=${winnerId}`);

        switch (m.round) {
            case 'GS1': await handleGS1(m, winnerId, scorerId); break;
            case 'GS2': await handleGS2(m, winnerId, scorerId); break;
            case 'QF':  await handleQF(m, winnerId, scorerId);  break;
            case 'QR':  await handleQR(m, winnerId, scorerId);  break;
            case 'ER':  await handleER(m, winnerId, scorerId);  break;
            case 'SF':  await handleSF(m, winnerId, scorerId);  break;
        }
    } catch(e) {
        console.error('Progression error:', e);
    }
}

// ─── GS1 → GS2 ───────────────────────────────────────────────────────────────
async function handleGS1(m, winnerId, scorerId) {
    const map = GS1_TO_GS2[m.match_number];
    if (!map) return;

    const sibling = await getMatch(map.sibling, m.sport_id, m.tournament_id, m.pool);
    if (!sibling?.winner_team_id) { console.log(`Waiting for ${map.sibling}`); return; }

    if (await matchExists(map.next, m.sport_id, m.tournament_id, m.pool)) return;

    await createMatch({ ...base(m, scorerId), round: 'GS2', match_number: map.next,
        team1_id: winnerId, team2_id: sibling.winner_team_id,
        parent_match1_id: m.match_id, parent_match2_id: sibling.match_id });
    console.log(`Created ${map.next} pool=${m.pool}`);
}

// ─── GS2 → QF ────────────────────────────────────────────────────────────────
async function handleGS2(m, winnerId, scorerId) {
    const map = GS2_TO_QF[m.match_number];
    if (!map) return;

    if (map.walkover) {
        if (await matchExists('M18', m.sport_id, m.tournament_id, m.pool)) return;
        await createMatch({ ...base(m, scorerId), round: 'QF', match_number: 'M18',
            team1_id: winnerId, team2_id: null,
            status: 'walkover', winner_team_id: winnerId,
            parent_match1_id: m.match_id, parent_match2_id: null });
        console.log(`M18 walkover pool=${m.pool}`);
        await tryCreateQR(m.tournament_id, m.sport_id, m, scorerId);
        return;
    }

    const sibling = await getMatch(map.sibling, m.sport_id, m.tournament_id, m.pool);
    if (!sibling?.winner_team_id) { console.log(`Waiting for ${map.sibling}`); return; }

    if (await matchExists(map.next, m.sport_id, m.tournament_id, m.pool)) return;

    await createMatch({ ...base(m, scorerId), round: 'QF', match_number: map.next,
        team1_id: winnerId, team2_id: sibling.winner_team_id,
        parent_match1_id: m.match_id, parent_match2_id: sibling.match_id });
    console.log(`Created ${map.next} pool=${m.pool}`);
}

// ─── QF → Qualifier Round ────────────────────────────────────────────────────
async function handleQF(m, winnerId, scorerId) {
    if (m.match_number === 'M18') return;
    await tryCreateQR(m.tournament_id, m.sport_id, m, scorerId);
}

async function tryCreateQR(tournamentId, sportId, refMatch, scorerId) {
    const pool = refMatch.pool;
    const m16 = await getMatch('M16', sportId, tournamentId, pool);
    const m17 = await getMatch('M17', sportId, tournamentId, pool);
    const m18 = await getMatch('M18', sportId, tournamentId, pool);

    if (!m16?.winner_team_id || !m17?.winner_team_id || !m18?.winner_team_id) return;
    if (await matchExists('QR1', sportId, tournamentId, pool)) return;

    const teams = [m16.winner_team_id, m17.winner_team_id, m18.winner_team_id];
    const md = base(refMatch, scorerId);

    await createMatch({ ...md, round: 'QR', match_number: 'QR1', team1_id: teams[0], team2_id: teams[1], parent_match1_id: m16.match_id, parent_match2_id: m17.match_id });
    await createMatch({ ...md, round: 'QR', match_number: 'QR2', team1_id: teams[1], team2_id: teams[2], parent_match1_id: m17.match_id, parent_match2_id: m18.match_id });
    await createMatch({ ...md, round: 'QR', match_number: 'QR3', team1_id: teams[2], team2_id: teams[0], parent_match1_id: m18.match_id, parent_match2_id: m16.match_id });
    console.log(`Created QR1/QR2/QR3 pool=${pool}`);
}

// ─── Qualifier Round → Eliminator ────────────────────────────────────────────
async function handleQR(m, winnerId, scorerId) {
    const tid = m.tournament_id, sid = m.sport_id, pool = m.pool;

    const [qr1, qr2, qr3] = await Promise.all([
        getMatch('QR1', sid, tid, pool),
        getMatch('QR2', sid, tid, pool),
        getMatch('QR3', sid, tid, pool)
    ]);

    if (!qr1?.winner_team_id || !qr2?.winner_team_id || !qr3?.winner_team_id) return;
    if (await matchExists('E1', sid, tid, pool)) return;

    // Rank by wins
    const pts = {};
    [qr1, qr2, qr3].forEach(qrm => {
        [qrm.team1_id, qrm.team2_id].forEach(t => { if (t && !pts[t]) pts[t] = 0; });
        if (qrm.winner_team_id) pts[qrm.winner_team_id]++;
    });
    const ranked = Object.entries(pts).sort((a, b) => b[1] - a[1]);
    const [q1Team, q2Team, q3Team] = ranked.map(r => r[0]);
    console.log(`QR ranked pool=${pool}: Q1=${q1Team} Q2=${q2Team} Q3=${q3Team}`);

    // Trace Q1's GS1+GS2 victims
    const victims = await traceVictims(q1Team, tid, sid, pool);

    if (victims.gs1Loser && victims.gs2Loser) {
        await createMatch({ ...base(m, scorerId), round: 'ER', match_number: 'E1',
            team1_id: victims.gs1Loser, team2_id: victims.gs2Loser,
            parent_match1_id: victims.gs1MatchId, parent_match2_id: victims.gs2MatchId });
        console.log(`Created E1 pool=${pool}`);
    }

    // For 2-entry: no direct Final yet — need SF first
    // For 1-entry: create Final with Q1
    const isTwoEntry = pool !== null && pool !== undefined;

    if (!isTwoEntry) {
        await createMatch({ ...base(m, scorerId), round: 'FINAL', match_number: 'FINAL',
            team1_id: q1Team, team2_id: null });
        console.log('Created FINAL (1-entry), Q1 confirmed');
    } else {
        // Store Q1 as pool finalist — check if other pool is ready for SF
        await tryCreateSF(tid, sid, scorerId, m);
    }
}

// ─── Trace Q1 team's GS1 + GS2 victims ───────────────────────────────────────
async function traceVictims(q1TeamId, tournamentId, sportId, pool) {
    const result = { gs1Loser: null, gs1MatchId: null, gs2Loser: null, gs2MatchId: null };
    const poolFilter = pool ? `&pool=eq.${pool}` : '&pool=is.null';

    const gs1 = await progFetch(`matches?round=eq.GS1&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}${poolFilter}&select=*`);
    for (const m of (gs1 || [])) {
        if (m.winner_team_id === q1TeamId) {
            result.gs1Loser   = m.team1_id === q1TeamId ? m.team2_id : m.team1_id;
            result.gs1MatchId = m.match_id;
        }
    }

    const gs2 = await progFetch(`matches?round=eq.GS2&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}${poolFilter}&select=*`);
    for (const m of (gs2 || [])) {
        if (m.winner_team_id === q1TeamId) {
            result.gs2Loser   = m.team1_id === q1TeamId ? m.team2_id : m.team1_id;
            result.gs2MatchId = m.match_id;
        }
    }

    return result;
}

// ─── Eliminator Round ─────────────────────────────────────────────────────────
async function handleER(m, winnerId, scorerId) {
    const tid = m.tournament_id, sid = m.sport_id, pool = m.pool;
    const md = base(m, scorerId);

    if (m.match_number === 'E1') {
        if (await matchExists('E2', sid, tid, pool)) return;
        const q3Team = await getQRRanked(tid, sid, pool, 3);
        if (!q3Team) return;
        await createMatch({ ...md, round: 'ER', match_number: 'E2',
            team1_id: winnerId, team2_id: q3Team, parent_match1_id: m.match_id });
        console.log(`Created E2 pool=${pool}`);
    }

    if (m.match_number === 'E2') {
        if (await matchExists('E3', sid, tid, pool)) return;
        const q2Team = await getQRRanked(tid, sid, pool, 2);
        if (!q2Team) return;
        await createMatch({ ...md, round: 'ER', match_number: 'E3',
            team1_id: winnerId, team2_id: q2Team, parent_match1_id: m.match_id });
        console.log(`Created E3 pool=${pool}`);
    }

    if (m.match_number === 'E3') {
        const isTwoEntry = pool !== null && pool !== undefined;
        if (!isTwoEntry) {
            // 1-entry: E3 winner fills Final slot 2
            const finalMatch = await progFetch(`matches?match_number=eq.FINAL&sport_id=eq.${sid}&tournament_id=eq.${tid}&pool=is.null&select=*`);
            if (finalMatch?.[0]) {
                await progFetch(`matches?match_id=eq.${finalMatch[0].match_id}`, {
                    method: 'PATCH', body: { team2_id: winnerId }
                });
                console.log('FINAL: E3 winner fills slot 2');
            }
        } else {
            // 2-entry: E3 winner is pool's 2nd finalist → try create SF
            await tryCreateSF(tid, sid, scorerId, m);
        }
    }
}

// ─── 2-entry: Create Semi Finals when both pools have finalists ───────────────
async function tryCreateSF(tournamentId, sportId, scorerId, refMatch) {
    // Get Q1 from each pool (pool finalist 1)
    const q1A = await getQRRanked(tournamentId, sportId, 'A', 1);
    const q1B = await getQRRanked(tournamentId, sportId, 'B', 1);

    // Get E3 winner from each pool (pool finalist 2)
    const e3A = await getMatch('E3', sportId, tournamentId, 'A');
    const e3B = await getMatch('E3', sportId, tournamentId, 'B');

    // SF1: Pool A Q1 vs Pool B Q1 (when both ready)
    if (q1A && q1B && !await matchExistsSF('SF1', sportId, tournamentId)) {
        await createMatch({
            tournament_id: tournamentId, sport_id: sportId,
            round: 'SF', match_number: 'SF1',
            team1_id: q1A, team2_id: q1B,
            points_per_set: refMatch.points_per_set, sets_to_win: refMatch.sets_to_win,
            scorer_id: scorerId || null, status: 'scheduled',
            winner_team_id: null, team1_id: q1A, team2_id: q1B,
            parent_match1_id: null, parent_match2_id: null, pool: null
        });
        console.log('Created SF1: Pool A Q1 vs Pool B Q1');
    }

    // SF2: Pool A E3 winner vs Pool B E3 winner (when both ready)
    if (e3A?.winner_team_id && e3B?.winner_team_id && !await matchExistsSF('SF2', sportId, tournamentId)) {
        await createMatch({
            tournament_id: tournamentId, sport_id: sportId,
            round: 'SF', match_number: 'SF2',
            team1_id: e3A.winner_team_id, team2_id: e3B.winner_team_id,
            points_per_set: refMatch.points_per_set, sets_to_win: refMatch.sets_to_win,
            scorer_id: scorerId || null, status: 'scheduled',
            winner_team_id: null, parent_match1_id: null, parent_match2_id: null, pool: null
        });
        console.log('Created SF2: Pool A E3 winner vs Pool B E3 winner');
    }
}

// ─── SF → Final ──────────────────────────────────────────────────────────────
async function handleSF(m, winnerId, scorerId) {
    const tid = m.tournament_id, sid = m.sport_id;
    const sf1 = await progFetch(`matches?match_number=eq.SF1&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
    const sf2 = await progFetch(`matches?match_number=eq.SF2&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);

    if (!sf1?.[0]?.winner_team_id || !sf2?.[0]?.winner_team_id) return;

    if (await matchExistsSF('FINAL', sid, tid)) return;

    await createMatch({
        tournament_id: tid, sport_id: sid,
        round: 'FINAL', match_number: 'FINAL',
        team1_id: sf1[0].winner_team_id, team2_id: sf2[0].winner_team_id,
        points_per_set: m.points_per_set, sets_to_win: m.sets_to_win,
        scorer_id: scorerId || null, status: 'scheduled',
        winner_team_id: null, parent_match1_id: sf1[0].match_id,
        parent_match2_id: sf2[0].match_id, pool: null
    });
    console.log('Created FINAL: SF1 winner vs SF2 winner');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getMatch(matchNumber, sportId, tournamentId, pool) {
    const poolFilter = pool ? `&pool=eq.${pool}` : '&pool=is.null';
    const rows = await progFetch(`matches?match_number=eq.${matchNumber}&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}${poolFilter}&select=*`);
    return rows?.[0] || null;
}

async function matchExists(matchNumber, sportId, tournamentId, pool) {
    return !!(await getMatch(matchNumber, sportId, tournamentId, pool));
}

async function matchExistsSF(matchNumber, sportId, tournamentId) {
    const rows = await progFetch(`matches?match_number=eq.${matchNumber}&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}&select=match_id`);
    return !!(rows?.length);
}

async function getQRRanked(tournamentId, sportId, pool, rank) {
    const [qr1, qr2, qr3] = await Promise.all([
        getMatch('QR1', sportId, tournamentId, pool),
        getMatch('QR2', sportId, tournamentId, pool),
        getMatch('QR3', sportId, tournamentId, pool)
    ]);
    if (!qr1 || !qr2 || !qr3) return null;

    const pts = {};
    [qr1, qr2, qr3].forEach(qrm => {
        [qrm.team1_id, qrm.team2_id].forEach(t => { if (t && !pts[t]) pts[t] = 0; });
        if (qrm.winner_team_id) pts[qrm.winner_team_id]++;
    });
    const ranked = Object.entries(pts).sort((a, b) => b[1] - a[1]);
    return ranked[rank - 1]?.[0] || null;
}

function base(m, scorerId) {
    return {
        tournament_id: m.tournament_id, sport_id: m.sport_id,
        points_per_set: m.points_per_set, sets_to_win: m.sets_to_win,
        scorer_id: scorerId || null, status: 'scheduled',
        winner_team_id: null, team1_id: null, team2_id: null,
        parent_match1_id: null, parent_match2_id: null, pool: m.pool || null,
        category: m.category || null
    };
}

async function createMatch(data) {
    const result = await progFetch('matches', {
        method: 'POST',
        body: {
            tournament_id: data.tournament_id, sport_id: data.sport_id,
            team1_id: data.team1_id || null, team2_id: data.team2_id || null,
            scheduled_time: null, status: data.status || 'scheduled',
            winner_team_id: data.winner_team_id || null,
            points_per_set: data.points_per_set || 21, sets_to_win: data.sets_to_win || 2,
            round: data.round, match_number: data.match_number,
            parent_match1_id: data.parent_match1_id || null,
            parent_match2_id: data.parent_match2_id || null,
            scorer_id: data.scorer_id || null,
            pool: data.pool || null, category: data.category || null
        }
    });
    return Array.isArray(result) ? result[0] : result;
}
