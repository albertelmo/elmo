const TOKEN_KEY = 'board_token';
const USER_KEY = 'board_user';
const POST_CATEGORIES = ['생각들', '사진들', '배움들'];
const PHOTO_CATEGORY = '사진들';

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

function isPhotoCategory(category) {
    return category === PHOTO_CATEGORY;
}

async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
    };

    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
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

function renderCategoryBadge(category) {
    const value = POST_CATEGORIES.includes(category) ? category : '생각들';
    return `<span class="category-badge category-${value}">${escapeHtml(value)}</span>`;
}

function renderCategorySelect(selectId, selectedValue, onChange) {
    const select = document.getElementById(selectId);
    if (!select) {
        return;
    }

    select.innerHTML = POST_CATEGORIES.map(category => {
        const selected = category === selectedValue ? ' selected' : '';
        return `<option value="${category}"${selected}>${category}</option>`;
    }).join('');

    if (onChange) {
        select.onchange = () => onChange(select.value);
    }
}

function renderCategoryTabs(containerId, activeCategory, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    const tabs = [{ label: '전체', value: '' }, ...POST_CATEGORIES.map(c => ({ label: c, value: c }))];

    container.innerHTML = tabs.map(tab => {
        const activeClass = tab.value === activeCategory ? ' active' : '';
        return `<button type="button" class="category-tab${activeClass}" data-category="${tab.value}">${tab.label}</button>`;
    }).join('');

    container.querySelectorAll('.category-tab').forEach(button => {
        button.addEventListener('click', () => {
            onSelect(button.dataset.category);
        });
    });
}

function updatePostFormByCategory(category) {
    const titleInput = document.getElementById('title');
    const contentInput = document.getElementById('content');
    const photoSection = document.getElementById('photo-section');
    const titleLabel = document.getElementById('title-label');
    const contentLabel = document.getElementById('content-label');

    if (!titleInput || !contentInput || !photoSection) {
        return;
    }

    if (isPhotoCategory(category)) {
        photoSection.style.display = 'block';
        titleInput.required = false;
        contentInput.required = false;
        if (titleLabel) titleLabel.textContent = '제목 (선택)';
        if (contentLabel) contentLabel.textContent = '설명 (선택)';
        titleInput.placeholder = '제목을 입력하세요 (선택)';
        contentInput.placeholder = '사진에 대한 설명을 입력하세요 (선택)';
    } else {
        photoSection.style.display = 'none';
        titleInput.required = true;
        contentInput.required = true;
        if (titleLabel) titleLabel.textContent = '제목';
        if (contentLabel) contentLabel.textContent = '내용';
        titleInput.placeholder = '제목을 입력하세요';
        contentInput.placeholder = '내용을 입력하세요';
    }
}

function readImageFiles(input) {
    return Array.from(input.files || []);
}

function renderImagePreviewList(container, items, onRemove) {
    if (!container) {
        return;
    }

    if (!items.length) {
        container.innerHTML = '<p class="photo-empty">선택된 사진이 없습니다.</p>';
        return;
    }

    container.innerHTML = items.map((item, index) => `
        <div class="photo-preview-item">
            <img src="${item.previewUrl}" alt="미리보기">
            <button type="button" class="photo-remove-btn" data-index="${index}">삭제</button>
        </div>
    `).join('');

    container.querySelectorAll('.photo-remove-btn').forEach(button => {
        button.addEventListener('click', () => {
            onRemove(Number(button.dataset.index));
        });
    });
}

function renderPostImages(images) {
    if (!images || !images.length) {
        return '';
    }

    return `
        <div class="post-images">
            ${images.map(url => `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="post-image-link">
                    <img src="${url}" alt="게시글 사진" class="post-image">
                </a>
            `).join('')}
        </div>
    `;
}

function renderPostPreview(post) {
    if (isPhotoCategory(post.category) && post.images && post.images.length > 0) {
        const countLabel = post.images.length > 1 ? `<span class="photo-count">+${post.images.length - 1}</span>` : '';
        return `
            <div class="post-photo-preview">
                <img src="${post.images[0]}" alt="사진 미리보기">
                ${countLabel}
            </div>
            ${post.content ? `<div class="post-preview">${escapeHtml(post.content.substring(0, 80))}${post.content.length > 80 ? '...' : ''}</div>` : ''}
        `;
    }

    const preview = post.content ? post.content.substring(0, 100) : '';
    return `<div class="post-preview">${escapeHtml(preview)}${post.content && post.content.length > 100 ? '...' : ''}</div>`;
}

function buildPostFormData(fields, imageFiles) {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value);
    });
    imageFiles.forEach(file => {
        formData.append('images', file);
    });
    return formData;
}
