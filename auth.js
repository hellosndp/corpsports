// Shared auth helpers — included in all scorer pages

const SUPABASE_URL = 'https://izutkprvzuwrxudqvnin.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dXRrcHJ2enV3cnh1ZHF2bmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NzYxNjUsImV4cCI6MjA5NTQ1MjE2NX0.MK80nCRgep3h8BpOt-Zy4EbizrXgndLD1XQCJJHIUCU';

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
