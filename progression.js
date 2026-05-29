// ─── Auto-Progression Engine ─────────────────────────────────────────────────
// Called after every match is finalized. Checks if the next match needs to be
// created and creates it automatically.

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
            'Prefer': method === 'POST' ? 'return=representation' : undefined,
            ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
    }
    if (method === 'POST') return res.json();
    return res.json();
}

// ─── GS1 pair → GS2 match mapping ────────────────────────────────────────────
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

// ─── GS2 pair → QF match mapping ─────────────────────────────────────────────
const GS2_TO_QF = {
    'M11': { sibling: 'M12', next: 'M16' },
    'M12': { sibling: 'M11', next: 'M16' },
    'M13': { sibling: 'M14', next: 'M17' },
    'M14': { sibling: 'M13', next: 'M17' },
    'M15': { walkover: true, next: 'M18' }, // auto-advances winner
};

// ─── QF pair → Qualifier mapping ─────────────────────────────────────────────
const QF_TO_QR = {
    'M16': { sibling: 'M17', next: 'Q1' },
    'M17': { sibling: 'M16', next: 'Q1' },
    'M18': { sibling: 'Q1',  next: 'Q2' }, // M18 winner waits for Q1
};

// ─── Main entry point ─────────────────────────────────────────────────────────
async function runProgression(completedMatchId, winnerId, scorerId) {
    try {
        console.log('Running progression for match:', completedMatchId);

        // Fetch the completed match
        const matches = await progFetch(
            `matches?match_id=eq.${completedMatchId}&select=*`
        );
        if (!matches || !matches.length) return;
        const m = matches[0];

        console.log(`Match ${m.match_number} (${m.round}) completed. Winner: ${winnerId}`);

        switch (m.round) {
            case 'GS1': await handleGS1(m, winnerId, scorerId); break;
            case 'GS2': await handleGS2(m, winnerId, scorerId); break;
            case 'QF':  await handleQF(m, winnerId, scorerId);  break;
            case 'QR':  await handleQR(m, winnerId, scorerId);  break;
            case 'ER':  await handleER(m, winnerId, scorerId);  break;
        }
    } catch (e) {
        console.error('Progression error:', e);
    }
}

// ─── GS1 → GS2 ───────────────────────────────────────────────────────────────
async function handleGS1(m, winnerId, scorerId) {
    const mapping = GS1_TO_GS2[m.match_number];
    if (!mapping) return;

    if (mapping.sibling) {
        // Check if sibling GS1 match is done
        const sibling = await progFetch(
            `matches?match_number=eq.${mapping.sibling}&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=*`
        );
        if (!sibling || !sibling.length || !sibling[0].winner_team_id) {
            console.log(`Waiting for sibling ${mapping.sibling} to finish`);
            return;
        }

        // Both GS1 matches done — create GS2 match
        const siblingWinner = sibling[0].winner_team_id;

        // Check if GS2 match already exists
        const existing = await progFetch(
            `matches?match_number=eq.${mapping.next}&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=match_id`
        );
        if (existing && existing.length) {
            console.log(`${mapping.next} already exists`);
            return;
        }

        await createMatch({
            tournament_id:    m.tournament_id,
            sport_id:         m.sport_id,
            team1_id:         winnerId,
            team2_id:         siblingWinner,
            round:            'GS2',
            match_number:     mapping.next,
            parent_match1_id: m.match_id,
            parent_match2_id: sibling[0].match_id,
            points_per_set:   m.points_per_set,
            sets_to_win:      m.sets_to_win,
            scorer_id:        scorerId
        });
        console.log(`Created ${mapping.next}`);
    }
}

// ─── GS2 → QF ────────────────────────────────────────────────────────────────
async function handleGS2(m, winnerId, scorerId) {
    const mapping = GS2_TO_QF[m.match_number];
    if (!mapping) return;

    // M15 is a walkover — winner auto-advances to M18
    if (mapping.walkover) {
        const existing = await progFetch(
            `matches?match_number=eq.M18&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=match_id`
        );
        if (existing && existing.length) return;

        // M18 is a walkover — create with team1 = winner, team2 = null
        await createMatch({
            tournament_id:    m.tournament_id,
            sport_id:         m.sport_id,
            team1_id:         winnerId,
            team2_id:         null,
            round:            'QF',
            match_number:     'M18',
            parent_match1_id: m.match_id,
            parent_match2_id: null,
            points_per_set:   m.points_per_set,
            sets_to_win:      m.sets_to_win,
            status:           'walkover',
            winner_team_id:   winnerId, // auto-win
            scorer_id:        scorerId
        });
        console.log('M18 walkover created, winner auto-set');

        // Immediately try to progress M18 walkover into QR
        await handleWalkoverM18(m, winnerId, scorerId);
        return;
    }

    // Check sibling
    const sibling = await progFetch(
        `matches?match_number=eq.${mapping.sibling}&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=*`
    );
    if (!sibling || !sibling.length || !sibling[0].winner_team_id) {
        console.log(`Waiting for sibling ${mapping.sibling}`);
        return;
    }

    const existing = await progFetch(
        `matches?match_number=eq.${mapping.next}&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=match_id`
    );
    if (existing && existing.length) return;

    await createMatch({
        tournament_id:    m.tournament_id,
        sport_id:         m.sport_id,
        team1_id:         winnerId,
        team2_id:         sibling[0].winner_team_id,
        round:            'QF',
        match_number:     mapping.next,
        parent_match1_id: m.match_id,
        parent_match2_id: sibling[0].match_id,
        points_per_set:   m.points_per_set,
        sets_to_win:      m.sets_to_win,
        scorer_id:        scorerId
    });
    console.log(`Created ${mapping.next}`);
}

// ─── QF → Qualifier Round ────────────────────────────────────────────────────
async function handleQF(m, winnerId, scorerId) {
    if (m.match_number === 'M18') return; // handled by handleWalkoverM18

    // M16 or M17 done → create Q1 when both done
    const sibling = await progFetch(
        `matches?match_number=eq.${m.match_number === 'M16' ? 'M17' : 'M16'}&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=*`
    );
    if (!sibling || !sibling.length || !sibling[0].winner_team_id) return;

    const existing = await progFetch(
        `matches?match_number=eq.Q1&sport_id=eq.${m.sport_id}&tournament_id=eq.${m.tournament_id}&select=match_id`
    );
    if (existing && existing.length) return;

    await createMatch({
        tournament_id:    m.tournament_id,
        sport_id:         m.sport_id,
        team1_id:         winnerId,
        team2_id:         sibling[0].winner_team_id,
        round:            'QR',
        match_number:     'Q1',
        parent_match1_id: m.match_id,
        parent_match2_id: sibling[0].match_id,
        points_per_set:   m.points_per_set,
        sets_to_win:      m.sets_to_win,
        scorer_id:        scorerId
    });
    console.log('Created Q1');

    // Also try to create Q2 if M18 already has a winner
    await tryCreateQ2(m.tournament_id, m.sport_id, m.points_per_set, m.sets_to_win, scorerId);
}

async function handleWalkoverM18(originalM15, winnerId, scorerId) {
    await tryCreateQ2(originalM15.tournament_id, originalM15.sport_id, originalM15.points_per_set, originalM15.sets_to_win, scorerId);
}

async function tryCreateQ2(tournamentId, sportId, pointsPerSet, setsToWin, scorerId) {
    const q1 = await progFetch(
        `matches?match_number=eq.Q1&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}&select=*`
    );
    const m18 = await progFetch(
        `matches?match_number=eq.M18&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}&select=*`
    );
    if (!q1?.[0]?.winner_team_id || !m18?.[0]?.winner_team_id) return;

    const existing = await progFetch(
        `matches?match_number=eq.Q2&sport_id=eq.${sportId}&tournament_id=eq.${tournamentId}&select=match_id`
    );
    if (existing && existing.length) return;

    await createMatch({
        tournament_id:    tournamentId,
        sport_id:         sportId,
        team1_id:         q1[0].winner_team_id,
        team2_id:         m18[0].winner_team_id,
        round:            'QR',
        match_number:     'Q2',
        parent_match1_id: q1[0].match_id,
        parent_match2_id: m18[0].match_id,
        points_per_set:   pointsPerSet,
        sets_to_win:      setsToWin,
        scorer_id:        scorerId
    });
    console.log('Created Q2');
}

// ─── Qualifier Round → Eliminator + Final ────────────────────────────────────
async function handleQR(m, winnerId, scorerId) {
    if (m.match_number === 'Q1') {
        // Q1 done — loser goes to E3 (collected later)
        // Try to create Q2 now
        await tryCreateQ2(m.tournament_id, m.sport_id, m.points_per_set, m.sets_to_win, scorerId);
    }

    if (m.match_number === 'Q2') {
        // Q2 winner → Final slot 1
        // Build entire Eliminator chain from Q2 winner's path
        await buildEliminatorChain(m, winnerId, scorerId);
    }
}

// ─── Build Eliminator from Q2 winner's victim chain ──────────────────────────
async function buildEliminatorChain(q2Match, q2WinnerId, scorerId) {
    // Trace Q2 winner's path back through all rounds
    // Victims: GS1 loser, GS2 loser, QF loser, Q1 loser

    const victims = await traceVictims(q2Match, q2WinnerId);
    console.log('Victim chain:', victims.map(v => v.match_number));

    // victims[0] = GS1 loser, victims[1] = GS2 loser,
    // victims[2] = QF loser,  victims[3] = Q1 loser

    if (victims.length < 4) {
        console.error('Could not build full eliminator chain, only found:', victims.length, 'victims');
        return;
    }

    // E1: GS1 loser vs GS2 loser
    const e1 = await createMatch({
        tournament_id:    q2Match.tournament_id,
        sport_id:         q2Match.sport_id,
        team1_id:         victims[0].loser_id,
        team2_id:         victims[1].loser_id,
        round:            'ER',
        match_number:     'E1',
        parent_match1_id: victims[0].match_id,
        parent_match2_id: victims[1].match_id,
        points_per_set:   q2Match.points_per_set,
        sets_to_win:      q2Match.sets_to_win,
        scorer_id:        scorerId
    });
    console.log('Created E1');

    // Store E2 parent info so we can create it after E1 result
    // E2: Winner E1 vs QF loser — will be auto-created when E1 finishes
    // Store QF loser and Q1 loser in match descriptions for now
    // We'll create E2/E3 when E1/E2 finish via handleER()

    // Store victim chain in a predictable way using match_number lookup
    // E2 and E3 are created reactively in handleER()
    console.log('Eliminator chain initiated. E2 and E3 will auto-create as results come in.');

    // Create Final slot (team2 TBD)
    const existingFinal = await progFetch(
        `matches?match_number=eq.FINAL&sport_id=eq.${q2Match.sport_id}&tournament_id=eq.${q2Match.tournament_id}&select=match_id`
    );
    if (!existingFinal || !existingFinal.length) {
        await createMatch({
            tournament_id:    q2Match.tournament_id,
            sport_id:         q2Match.sport_id,
            team1_id:         q2WinnerId, // Q2 winner confirmed
            team2_id:         null,       // ER winner TBD
            round:            'FINAL',
            match_number:     'FINAL',
            parent_match1_id: q2Match.match_id,
            parent_match2_id: null,
            points_per_set:   q2Match.points_per_set,
            sets_to_win:      q2Match.sets_to_win,
            scorer_id:        scorerId
        });
        console.log('Created FINAL (slot 1 filled)');
    }
}

async function traceVictims(q2Match, q2WinnerId) {
    const victims = [];
    const tid = q2Match.tournament_id;
    const sid = q2Match.sport_id;

    // Q2 winner came from Q1 or M18
    // Find which team in Q2 is the winner and trace their path
    const q1 = await progFetch(`matches?match_number=eq.Q1&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
    const m18 = await progFetch(`matches?match_number=eq.M18&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);

    // Determine which Q2 team came from Q1 (that's the one we trace)
    // Q2 winner is the one who beat everyone — trace their Q1 origin
    let tracedTeam = q2WinnerId;

    // Q1 victim
    if (q1?.[0]) {
        const q1Loser = q1[0].team1_id === tracedTeam ? q1[0].team2_id : q1[0].team1_id;
        if (q1[0].winner_team_id === tracedTeam) {
            victims.push({ match_id: q1[0].match_id, loser_id: q1Loser, match_number: 'Q1' });
        }
    }

    // Trace through QF (M16 or M17)
    const qfMatches = await progFetch(`matches?round=eq.QF&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
    for (const qf of (qfMatches || [])) {
        if (qf.winner_team_id === tracedTeam && qf.match_number !== 'M18') {
            const loser = qf.team1_id === tracedTeam ? qf.team2_id : qf.team1_id;
            victims.push({ match_id: qf.match_id, loser_id: loser, match_number: qf.match_number });
        }
    }

    // Trace through GS2
    const gs2Matches = await progFetch(`matches?round=eq.GS2&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
    for (const gs2 of (gs2Matches || [])) {
        if (gs2.winner_team_id === tracedTeam) {
            const loser = gs2.team1_id === tracedTeam ? gs2.team2_id : gs2.team1_id;
            victims.push({ match_id: gs2.match_id, loser_id: loser, match_number: gs2.match_number });
        }
    }

    // Trace through GS1
    const gs1Matches = await progFetch(`matches?round=eq.GS1&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
    for (const gs1 of (gs1Matches || [])) {
        if (gs1.winner_team_id === tracedTeam) {
            const loser = gs1.team1_id === tracedTeam ? gs1.team2_id : gs1.team1_id;
            victims.push({ match_id: gs1.match_id, loser_id: loser, match_number: gs1.match_number });
        }
    }

    // Order: GS1, GS2, QF, Q1 (oldest first)
    const order = { 'GS1': 0, 'GS2': 1, 'QF': 2, 'Q1': 3 };
    victims.sort((a, b) => {
        const ra = a.match_number.startsWith('M') ? (parseInt(a.match_number.slice(1)) <= 10 ? 0 : parseInt(a.match_number.slice(1)) <= 15 ? 1 : 2) : 3;
        const rb = b.match_number.startsWith('M') ? (parseInt(b.match_number.slice(1)) <= 10 ? 0 : parseInt(b.match_number.slice(1)) <= 15 ? 1 : 2) : 3;
        return ra - rb;
    });

    return victims;
}

// ─── Eliminator Round progression ────────────────────────────────────────────
async function handleER(m, winnerId, scorerId) {
    const tid = m.tournament_id;
    const sid = m.sport_id;

    if (m.match_number === 'E1') {
        // E2: Winner E1 vs QF loser
        // Find QF loser (loser of M16 or M17 that is in the victim chain)
        const qfMatches = await progFetch(`matches?round=eq.QF&sport_id=eq.${sid}&tournament_id=eq.${tid}&not.match_number=eq.M18&select=*`);
        
        // Find the QF loser who lost to the Q2 winner's path
        // Look for QF matches whose loser is NOT already in E1
        const e1Match = await progFetch(`matches?match_number=eq.E1&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
        const e1Teams = e1Match?.[0] ? [e1Match[0].team1_id, e1Match[0].team2_id] : [];

        let qfLoser = null;
        for (const qf of (qfMatches || [])) {
            if (qf.winner_team_id) {
                const loser = qf.team1_id === qf.winner_team_id ? qf.team2_id : qf.team1_id;
                if (!e1Teams.includes(loser)) { qfLoser = loser; break; }
            }
        }

        if (!qfLoser) { console.log('QF loser not found for E2'); return; }

        const existing = await progFetch(`matches?match_number=eq.E2&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=match_id`);
        if (existing?.length) return;

        await createMatch({
            tournament_id: tid, sport_id: sid,
            team1_id: winnerId, team2_id: qfLoser,
            round: 'ER', match_number: 'E2',
            parent_match1_id: m.match_id,
            points_per_set: m.points_per_set, sets_to_win: m.sets_to_win, scorer_id: scorerId
        });
        console.log('Created E2');
    }

    if (m.match_number === 'E2') {
        // E3: Winner E2 vs Q1 loser
        const q1 = await progFetch(`matches?match_number=eq.Q1&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
        if (!q1?.[0]?.winner_team_id) return;
        const q1Loser = q1[0].team1_id === q1[0].winner_team_id ? q1[0].team2_id : q1[0].team1_id;

        const existing = await progFetch(`matches?match_number=eq.E3&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=match_id`);
        if (existing?.length) return;

        await createMatch({
            tournament_id: tid, sport_id: sid,
            team1_id: winnerId, team2_id: q1Loser,
            round: 'ER', match_number: 'E3',
            parent_match1_id: m.match_id,
            points_per_set: m.points_per_set, sets_to_win: m.sets_to_win, scorer_id: scorerId
        });
        console.log('Created E3');
    }

    if (m.match_number === 'E3') {
        // E3 winner fills slot 2 in the Final
        const finalMatch = await progFetch(`matches?match_number=eq.FINAL&sport_id=eq.${sid}&tournament_id=eq.${tid}&select=*`);
        if (!finalMatch?.[0]) return;

        await progFetch(`matches?match_id=eq.${finalMatch[0].match_id}`, {
            method: 'PATCH',
            body: { team2_id: winnerId }
        });
        console.log('Final slot 2 filled with E3 winner');
    }
}

// ─── Create match helper ──────────────────────────────────────────────────────
async function createMatch(data) {
    const payload = {
        tournament_id:    data.tournament_id,
        sport_id:         data.sport_id,
        team1_id:         data.team1_id,
        team2_id:         data.team2_id || null,
        scheduled_time:   null,
        status:           data.status || 'scheduled',
        winner_team_id:   data.winner_team_id || null,
        points_per_set:   data.points_per_set || 21,
        sets_to_win:      data.sets_to_win || 2,
        round:            data.round,
        match_number:     data.match_number,
        parent_match1_id: data.parent_match1_id || null,
        parent_match2_id: data.parent_match2_id || null,
        scorer_id:        data.scorer_id || null
    };

    const result = await progFetch('matches', {
        method: 'POST',
        extraHeaders: { 'Prefer': 'return=representation' },
        body: payload
    });
    return Array.isArray(result) ? result[0] : result;
}
