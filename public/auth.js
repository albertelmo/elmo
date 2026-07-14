const TOKEN_KEY = 'board_token';
const USER_KEY = 'board_user';

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

function requireAuth() {
    if (!getToken()) {
        const redirect = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
        window.location.href = `login.html?redirect=${redirect}`;
        return false;
    }
    return true;
}

function redirectIfLoggedIn() {
    if (getToken()) {
        window.location.href = 'index.html';
    }
}

async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
    };

    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        clearAuth();
        window.location.href = 'login.html';
        throw new Error('Unauthorized');
    }

    return response;
}

function canModifyPost(user, post) {
    if (!user || !post) {
        return false;
    }
    if (user.role === 'admin') {
        return true;
    }
    if (!post.user_id) {
        return false;
    }
    return post.user_id === user.id;
}

function renderUserHeader(containerId) {
    const container = document.getElementById(containerId);
    const user = getUser();
    if (!container || !user) {
        return;
    }

    const roleLabel = user.role === 'admin' ? '관리자' : '회원';
    container.innerHTML = `
        <div class="auth-user">
            <span class="auth-user-name">${escapeHtml(user.name)}</span>
            <span class="auth-user-role">${roleLabel}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="logout()">로그아웃</button>
        </div>
    `;
}

function logout() {
    clearAuth();
    window.location.href = 'login.html';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
