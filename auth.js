// Shared auth helpers — no Supabase constants here (each page defines its own)

function getScorer() {
    return {
        id:       sessionStorage.getItem('scorer_id'),
        name:     sessionStorage.getItem('scorer_name'),
        username: sessionStorage.getItem('scorer_user')
    };
}

function requireAuth() {
    const scorer = getScorer();
    if (!scorer.id) {
        window.location.href = 'login.html';
        return null;
    }
    return scorer;
}

function logout() {
    sessionStorage.clear();
    window.location.href = 'login.html';
}
