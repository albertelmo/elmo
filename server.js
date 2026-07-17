const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./database');
const { verifyAuth, canModifyPost, signToken } = require('./middleware');
const { CATEGORIES, isValidCategory, isPhotoCategory } = require('./categories');
const { OWNERS, ASSET_TYPES, isValidOwner, isValidAssetType, getAssetTypeConfig } = require('./asset-categories');
const { CATS } = require('./cat-categories');
const {
    UPLOADS_DIR,
    postImagesUpload,
    savePostImages,
    deletePostImageDir,
    cleanupRemovedImages,
    ensureUploadsDir
} = require('./upload-utils');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
// 신규 가입을 임시로 막고 싶을 때 false로 변경
const REGISTRATION_ENABLED = false;

const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const allowed = /\.(xlsx|xls|csv)$/i.test(file.originalname);
        if (allowed) {
            cb(null, true);
            return;
        }
        cb(new Error('Excel(.xlsx, .xls) 또는 CSV 파일만 업로드할 수 있습니다.'));
    }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

ensureUploadsDir();
db.initializeDatabase();

function resolveRole(username) {
    if (ADMIN_USERNAME && username === ADMIN_USERNAME) {
        return 'admin';
    }
    return 'user';
}

function handleImageUpload(req, res, next) {
    postImagesUpload(req, res, (err) => {
        if (err) {
            return res.status(400).json({ message: err.message || '이미지 업로드에 실패했습니다.' });
        }
        next();
    });
}

function parseKeepImages(value) {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter(url => typeof url === 'string') : [];
    } catch {
        return [];
    }
}

function normalizePostInput(body, category) {
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();

    if (!isValidCategory(category)) {
        return { error: '유효하지 않은 카테고리입니다.' };
    }

    if (isPhotoCategory(category)) {
        return {
            title: title || '사진',
            content
        };
    }

    if (!title || !content) {
        return { error: '제목과 내용을 입력해주세요.' };
    }

    return { title, content };
}

function normalizeAssetEntries(rawEntries, usdKrw) {
    if (!Array.isArray(rawEntries)) {
        return { error: '자산 항목 형식이 올바르지 않습니다.' };
    }

    const entries = [];

    for (const raw of rawEntries) {
        const owner = raw.owner;
        const assetType = raw.assetType;

        if (!isValidOwner(owner) || !isValidAssetType(assetType)) {
            return { error: '유효하지 않은 자산 항목입니다.' };
        }

        const typeConfig = getAssetTypeConfig(assetType);
        let amountUsd = null;
        let amountKrw;

        if (typeConfig.isForeign) {
            amountUsd = Number(raw.amountUsd);
            if (!amountUsd || amountUsd <= 0) {
                continue;
            }
            amountKrw = Math.round(amountUsd * usdKrw * 100) / 100;
        } else {
            amountKrw = Number(raw.amountKrw);
            if (!amountKrw || amountKrw <= 0) {
                continue;
            }
        }

        const hasReturnRateInput = raw.returnRate !== undefined && raw.returnRate !== null && raw.returnRate !== '';
        const returnRate = typeConfig.hasReturnRate && hasReturnRateInput ? Number(raw.returnRate) : null;
        const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 50) : '';

        entries.push({ owner, assetType, label, amountKrw, amountUsd, returnRate });
    }

    return { entries };
}

app.get('/api/auth/register-status', (req, res) => {
    res.json({ enabled: REGISTRATION_ENABLED });
});

app.post('/api/auth/register', async (req, res) => {
    try {
        if (!REGISTRATION_ENABLED) {
            return res.status(403).json({ message: '현재 회원가입이 잠시 중단되었습니다.' });
        }

        const { username, password, name } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ message: '아이디, 비밀번호, 이름을 모두 입력해주세요.' });
        }

        const trimmedUsername = username.trim();
        const trimmedName = name.trim();

        if (trimmedUsername.length < 3 || trimmedUsername.length > 50) {
            return res.status(400).json({ message: '아이디는 3~50자여야 합니다.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: '비밀번호는 6자 이상이어야 합니다.' });
        }
        if (trimmedName.length < 1 || trimmedName.length > 50) {
            return res.status(400).json({ message: '이름은 1~50자여야 합니다.' });
        }

        const existingUser = await db.getUserByUsername(trimmedUsername);
        if (existingUser) {
            return res.status(400).json({ message: '이미 사용 중인 아이디입니다.' });
        }

        const role = resolveRole(trimmedUsername);
        const user = await db.createUser(trimmedUsername, password, trimmedName, role);
        const token = signToken(user);

        res.status(201).json({
            message: '회원가입이 완료되었습니다.',
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('[API] 회원가입 오류:', error);
        if (error.code === '23505') {
            return res.status(400).json({ message: '이미 사용 중인 아이디입니다.' });
        }
        res.status(500).json({ message: '회원가입 중 오류가 발생했습니다.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '아이디와 비밀번호를 입력해주세요.' });
        }

        const user = await db.verifyPassword(username.trim(), password);
        if (!user) {
            return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }

        const token = signToken(user);
        res.json({
            message: '로그인 성공',
            token,
            user
        });
    } catch (error) {
        console.error('[API] 로그인 오류:', error);
        res.status(500).json({ message: '로그인 중 오류가 발생했습니다.' });
    }
});

app.get('/api/auth/me', verifyAuth, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.userId);
        if (!user) {
            return res.status(401).json({ message: '사용자를 찾을 수 없습니다.' });
        }
        res.json({
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        });
    } catch (error) {
        console.error('[API] 사용자 정보 조회 오류:', error);
        res.status(500).json({ message: '사용자 정보를 불러오지 못했습니다.' });
    }
});

app.get('/api/categories', verifyAuth, (req, res) => {
    res.json(CATEGORIES);
});

app.get('/api/posts', verifyAuth, async (req, res) => {
    try {
        const category = req.query.category;
        if (category && !isValidCategory(category)) {
            return res.status(400).json({ message: '유효하지 않은 카테고리입니다.' });
        }

        const posts = await db.getPosts(category || null);
        res.json(posts);
    } catch (error) {
        console.error('[API] 게시글 목록 조회 오류:', error);
        res.status(500).json({ message: '게시글 목록을 불러오지 못했습니다.' });
    }
});

app.get('/api/posts/:id', verifyAuth, async (req, res) => {
    try {
        const postId = req.params.id;
        const post = await db.getPostById(postId);

        if (!post) {
            return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
        }

        await db.incrementViews(postId);
        post.views = post.views + 1;

        res.json(post);
    } catch (error) {
        console.error('[API] 게시글 상세 조회 오류:', error);
        res.status(500).json({ message: '게시글을 불러오지 못했습니다.' });
    }
});

app.post('/api/posts', verifyAuth, handleImageUpload, async (req, res) => {
    try {
        const category = (req.body.category || '').trim();
        const normalized = normalizePostInput(req.body, category);
        if (normalized.error) {
            return res.status(400).json({ message: normalized.error });
        }

        const files = req.files || [];
        if (isPhotoCategory(category) && files.length === 0) {
            return res.status(400).json({ message: '사진을 1장 이상 업로드해주세요.' });
        }
        if (!isPhotoCategory(category) && files.length > 0) {
            return res.status(400).json({ message: '사진 업로드는 사진들 카테고리에서만 가능합니다.' });
        }

        const newPost = await db.createPost(
            normalized.title,
            normalized.content,
            req.user.name,
            req.user.userId,
            category,
            []
        );

        let imageUrls = [];
        if (files.length > 0) {
            imageUrls = savePostImages(newPost.id, files);
            const updatedPost = await db.updatePost(
                newPost.id,
                normalized.title,
                normalized.content,
                category,
                imageUrls
            );
            return res.json({ message: '게시글이 작성되었습니다.', post: updatedPost });
        }

        res.json({ message: '게시글이 작성되었습니다.', post: newPost });
    } catch (error) {
        console.error('[API] 게시글 작성 오류:', error);
        res.status(500).json({ message: '게시글 작성에 실패했습니다.' });
    }
});

app.put('/api/posts/:id', verifyAuth, handleImageUpload, async (req, res) => {
    try {
        const postId = req.params.id;
        const category = (req.body.category || '').trim();
        const normalized = normalizePostInput(req.body, category);
        if (normalized.error) {
            return res.status(400).json({ message: normalized.error });
        }

        const post = await db.getPostById(postId);
        if (!post) {
            return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
        }

        if (!canModifyPost(req.user, post)) {
            return res.status(403).json({ message: '수정 권한이 없습니다.' });
        }

        const files = req.files || [];
        if (!isPhotoCategory(category) && files.length > 0) {
            return res.status(400).json({ message: '사진 업로드는 사진들 카테고리에서만 가능합니다.' });
        }

        let nextImages = [];
        if (isPhotoCategory(category)) {
            const keepImages = parseKeepImages(req.body.keep_images);
            const validKeepImages = keepImages.filter(url => (post.images || []).includes(url));
            const newImageUrls = files.length > 0 ? savePostImages(postId, files) : [];
            nextImages = [...validKeepImages, ...newImageUrls];

            if (nextImages.length === 0) {
                return res.status(400).json({ message: '사진을 1장 이상 남겨주세요.' });
            }
        } else if ((post.images || []).length > 0) {
            cleanupRemovedImages(post.images, []);
            deletePostImageDir(postId);
        }

        const previousImages = post.images || [];
        const updatedPost = await db.updatePost(
            postId,
            normalized.title,
            normalized.content,
            category,
            nextImages
        );

        if (isPhotoCategory(category)) {
            cleanupRemovedImages(previousImages, nextImages);
        }

        res.json({ message: '게시글이 수정되었습니다.', post: updatedPost });
    } catch (error) {
        console.error('[API] 게시글 수정 오류:', error);
        res.status(500).json({ message: '게시글 수정에 실패했습니다.' });
    }
});

app.delete('/api/posts/:id', verifyAuth, async (req, res) => {
    try {
        const postId = req.params.id;
        const post = await db.getPostById(postId);

        if (!post) {
            return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
        }

        if (!canModifyPost(req.user, post)) {
            return res.status(403).json({ message: '삭제 권한이 없습니다.' });
        }

        await db.deletePost(postId);
        deletePostImageDir(postId);

        res.json({ message: '게시글이 삭제되었습니다.' });
    } catch (error) {
        console.error('[API] 게시글 삭제 오류:', error);
        res.status(500).json({ message: '게시글 삭제에 실패했습니다.' });
    }
});

let usdKrwRateCache = { rate: null, date: null, fetchedAt: 0 };
const USD_KRW_CACHE_MS = 60 * 60 * 1000;

async function fetchUsdKrwRate() {
    const now = Date.now();
    if (usdKrwRateCache.rate && (now - usdKrwRateCache.fetchedAt) < USD_KRW_CACHE_MS) {
        return usdKrwRateCache;
    }

    const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
    if (!response.ok) {
        throw new Error(`Exchange rate fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const rate = data.rates && data.rates.KRW;
    if (!rate) {
        throw new Error('KRW rate not found');
    }

    usdKrwRateCache = {
        rate: Math.round(Number(rate) * 100) / 100,
        date: data.date,
        fetchedAt: now
    };
    return usdKrwRateCache;
}

app.get('/api/exchange-rate/usd-krw', verifyAuth, async (req, res) => {
    try {
        const cached = await fetchUsdKrwRate();
        res.json({
            rate: cached.rate,
            date: cached.date,
            source: 'ECB 기준 (Frankfurter)'
        });
    } catch (error) {
        console.error('[API] 환율 조회 오류:', error);
        res.status(503).json({ message: '환율 정보를 불러오지 못했습니다.' });
    }
});

app.get('/api/asset-meta', verifyAuth, (req, res) => {
    res.json({ owners: OWNERS, assetTypes: ASSET_TYPES });
});

app.get('/api/assets/snapshots', verifyAuth, async (req, res) => {
    try {
        const snapshots = await db.getAssetSnapshots();
        res.json(snapshots);
    } catch (error) {
        console.error('[API] 자산 스냅샷 목록 조회 오류:', error);
        res.status(500).json({ message: '자산 정보를 불러오지 못했습니다.' });
    }
});

app.get('/api/assets/snapshots/:id', verifyAuth, async (req, res) => {
    try {
        const snapshot = await db.getAssetSnapshotById(req.params.id);
        if (!snapshot) {
            return res.status(404).json({ message: '자산 입력 기록을 찾을 수 없습니다.' });
        }
        res.json(snapshot);
    } catch (error) {
        console.error('[API] 자산 스냅샷 조회 오류:', error);
        res.status(500).json({ message: '자산 정보를 불러오지 못했습니다.' });
    }
});

app.post('/api/assets/snapshots', verifyAuth, async (req, res) => {
    try {
        const recordedAt = (req.body.recordedAt || '').trim();
        const usdKrw = Number(req.body.usdKrw);
        const note = (req.body.note || '').trim();

        if (!recordedAt) {
            return res.status(400).json({ message: '입력일을 선택해주세요.' });
        }
        if (!usdKrw || usdKrw <= 0) {
            return res.status(400).json({ message: '달러환율을 입력해주세요.' });
        }

        const normalized = normalizeAssetEntries(req.body.entries, usdKrw);
        if (normalized.error) {
            return res.status(400).json({ message: normalized.error });
        }
        if (normalized.entries.length === 0) {
            return res.status(400).json({ message: '자산을 1개 이상 입력해주세요.' });
        }

        const snapshot = await db.createAssetSnapshot(recordedAt, usdKrw, note, req.user.userId, normalized.entries);
        res.status(201).json({ message: '자산 정보가 저장되었습니다.', snapshot });
    } catch (error) {
        console.error('[API] 자산 스냅샷 작성 오류:', error);
        res.status(500).json({ message: '자산 정보를 저장하지 못했습니다.' });
    }
});

app.put('/api/assets/snapshots/:id', verifyAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const recordedAt = (req.body.recordedAt || '').trim();
        const usdKrw = Number(req.body.usdKrw);
        const note = (req.body.note || '').trim();

        if (!recordedAt) {
            return res.status(400).json({ message: '입력일을 선택해주세요.' });
        }
        if (!usdKrw || usdKrw <= 0) {
            return res.status(400).json({ message: '달러환율을 입력해주세요.' });
        }

        const normalized = normalizeAssetEntries(req.body.entries, usdKrw);
        if (normalized.error) {
            return res.status(400).json({ message: normalized.error });
        }
        if (normalized.entries.length === 0) {
            return res.status(400).json({ message: '자산을 1개 이상 입력해주세요.' });
        }

        const snapshot = await db.updateAssetSnapshot(id, recordedAt, usdKrw, note, normalized.entries);
        if (!snapshot) {
            return res.status(404).json({ message: '자산 입력 기록을 찾을 수 없습니다.' });
        }

        res.json({ message: '자산 정보가 수정되었습니다.', snapshot });
    } catch (error) {
        console.error('[API] 자산 스냅샷 수정 오류:', error);
        res.status(500).json({ message: '자산 정보를 수정하지 못했습니다.' });
    }
});

app.delete('/api/assets/snapshots/:id', verifyAuth, async (req, res) => {
    try {
        const deleted = await db.deleteAssetSnapshot(req.params.id);
        if (!deleted) {
            return res.status(404).json({ message: '자산 입력 기록을 찾을 수 없습니다.' });
        }
        res.json({ message: '자산 입력 기록이 삭제되었습니다.' });
    } catch (error) {
        console.error('[API] 자산 스냅샷 삭제 오류:', error);
        res.status(500).json({ message: '자산 입력 기록을 삭제하지 못했습니다.' });
    }
});

const DATE_HEADER_KEYS = ['날짜', 'date', '기록일', '측정일', 'recorded_at', 'recorded at'];
const MINI_HEADER_KEYS = ['미니', 'mini'];
const RABI_HEADER_KEYS = ['라비', 'rabi', 'ravi'];

function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findHeaderIndex(headers, candidates) {
    return headers.findIndex(header => candidates.includes(header));
}

function formatYmdFromParts(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCatRecordedDate(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatYmdFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }

    if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) {
            return formatYmdFromParts(parsed.y, parsed.m, parsed.d);
        }
    }

    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
    }

    const normalized = raw.replace(/[./]/g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        return formatYmdFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    const parsedDate = new Date(raw);
    if (!Number.isNaN(parsedDate.getTime())) {
        return formatYmdFromParts(parsedDate.getFullYear(), parsedDate.getMonth() + 1, parsedDate.getDate());
    }

    return null;
}

function parseCatWeightValue(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const num = Number(String(value).replace(/,/g, '').trim());
    if (Number.isNaN(num) || num <= 0) {
        return null;
    }
    return Math.round(num * 100) / 100;
}

function normalizeManualCatWeightPayload(body, existingMiniKg = null) {
    const recordedAt = parseCatRecordedDate(body.recordedAt);
    const rabiKg = parseCatWeightValue(body.rabiKg);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

    if (!recordedAt) {
        return { error: '날짜를 올바르게 입력해주세요.' };
    }
    if (rabiKg === null) {
        return { error: '라비 몸무게를 입력해주세요.' };
    }

    return {
        recordedAt,
        miniKg: existingMiniKg,
        rabiKg,
        note
    };
}

function normalizeCatWeightPayload(body) {
    const recordedAt = parseCatRecordedDate(body.recordedAt);
    const miniKg = parseCatWeightValue(body.miniKg);
    const rabiKg = parseCatWeightValue(body.rabiKg);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

    if (!recordedAt) {
        return { error: '날짜를 올바르게 입력해주세요.' };
    }
    if (miniKg === null && rabiKg === null) {
        return { error: '미니 또는 라비 몸무게를 1개 이상 입력해주세요.' };
    }

    return { recordedAt, miniKg, rabiKg, note };
}

function parseCatWeightWorkbook(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return { error: '시트를 찾을 수 없습니다.' };
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: ''
    });

    if (!rows.length) {
        return { error: '엑셀에 데이터가 없습니다.' };
    }

    let headerRowIndex = -1;
    let dateIndex = -1;
    let miniIndex = -1;
    let rabiIndex = -1;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const headers = rows[i].map(cell => normalizeHeader(cell));
        const foundDate = findHeaderIndex(headers, DATE_HEADER_KEYS);
        const foundMini = findHeaderIndex(headers, MINI_HEADER_KEYS);
        const foundRabi = findHeaderIndex(headers, RABI_HEADER_KEYS);
        if (foundDate !== -1 && (foundMini !== -1 || foundRabi !== -1)) {
            headerRowIndex = i;
            dateIndex = foundDate;
            miniIndex = foundMini;
            rabiIndex = foundRabi;
            break;
        }
    }

    if (headerRowIndex === -1) {
        return { error: '헤더 행을 찾을 수 없습니다. (날짜, 미니, 라비 열 필요)' };
    }

    const records = [];
    const skipped = [];

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const recordedAt = parseCatRecordedDate(row[dateIndex]);
        const miniKg = miniIndex === -1 ? null : parseCatWeightValue(row[miniIndex]);
        const rabiKg = rabiIndex === -1 ? null : parseCatWeightValue(row[rabiIndex]);

        if (!recordedAt && miniKg === null && rabiKg === null) {
            continue;
        }
        if (!recordedAt) {
            skipped.push({ row: i + 1, reason: '날짜 형식 오류' });
            continue;
        }
        if (miniKg === null && rabiKg === null) {
            skipped.push({ row: i + 1, reason: '몸무게 없음' });
            continue;
        }

        records.push({ recordedAt, miniKg, rabiKg, note: '' });
    }

    if (!records.length) {
        return { error: '가져올 유효한 기록이 없습니다.', skipped };
    }

    return { records, skipped };
}

app.get('/api/cat-meta', verifyAuth, (req, res) => {
    res.json({ cats: CATS });
});

app.get('/api/cat-weights', verifyAuth, async (req, res) => {
    try {
        const records = await db.getCatWeightRecords();
        res.json(records);
    } catch (error) {
        console.error('[API] 고양이 몸무게 목록 조회 오류:', error);
        res.status(500).json({ message: '몸무게 기록을 불러오지 못했습니다.' });
    }
});

app.post('/api/cat-weights', verifyAuth, async (req, res) => {
    try {
        const normalized = normalizeManualCatWeightPayload(req.body);
        if (normalized.error) {
            return res.status(400).json({ message: normalized.error });
        }

        const existing = await db.getCatWeightRecordByDate(normalized.recordedAt);
        if (existing) {
            return res.status(400).json({ message: '같은 날짜의 기록이 이미 있습니다. 수정하거나 엑셀 가져오기를 사용해주세요.' });
        }

        const record = await db.createCatWeightRecord(
            normalized.recordedAt,
            normalized.miniKg,
            normalized.rabiKg,
            normalized.note,
            req.user.userId
        );
        res.status(201).json({ message: '몸무게 기록이 저장되었습니다.', record });
    } catch (error) {
        console.error('[API] 고양이 몸무게 저장 오류:', error);
        res.status(500).json({ message: '몸무게 기록을 저장하지 못했습니다.' });
    }
});

app.put('/api/cat-weights/:id', verifyAuth, async (req, res) => {
    try {
        const existing = await db.getCatWeightRecordById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: '몸무게 기록을 찾을 수 없습니다.' });
        }

        const normalized = normalizeManualCatWeightPayload(req.body, existing.mini_kg);
        if (normalized.error) {
            return res.status(400).json({ message: normalized.error });
        }

        const duplicate = await db.getCatWeightRecordByDate(normalized.recordedAt);
        if (duplicate && duplicate.id !== req.params.id) {
            return res.status(400).json({ message: '같은 날짜의 다른 기록이 이미 있습니다.' });
        }

        const record = await db.updateCatWeightRecord(
            req.params.id,
            normalized.recordedAt,
            normalized.miniKg,
            normalized.rabiKg,
            normalized.note
        );
        res.json({ message: '몸무게 기록이 수정되었습니다.', record });
    } catch (error) {
        console.error('[API] 고양이 몸무게 수정 오류:', error);
        res.status(500).json({ message: '몸무게 기록을 수정하지 못했습니다.' });
    }
});

app.delete('/api/cat-weights/:id', verifyAuth, async (req, res) => {
    try {
        const deleted = await db.deleteCatWeightRecord(req.params.id);
        if (!deleted) {
            return res.status(404).json({ message: '몸무게 기록을 찾을 수 없습니다.' });
        }
        res.json({ message: '몸무게 기록이 삭제되었습니다.' });
    } catch (error) {
        console.error('[API] 고양이 몸무게 삭제 오류:', error);
        res.status(500).json({ message: '몸무게 기록을 삭제하지 못했습니다.' });
    }
});

app.post('/api/cat-weights/import', verifyAuth, (req, res) => {
    excelUpload.single('file')(req, res, async (uploadError) => {
        if (uploadError) {
            return res.status(400).json({ message: uploadError.message || '파일 업로드에 실패했습니다.' });
        }
        if (!req.file) {
            return res.status(400).json({ message: '엑셀 파일을 선택해주세요.' });
        }

        try {
            const parsed = parseCatWeightWorkbook(req.file.buffer);
            if (parsed.error) {
                return res.status(400).json({
                    message: parsed.error,
                    skipped: parsed.skipped || []
                });
            }

            let imported = 0;
            for (const item of parsed.records) {
                await db.upsertCatWeightRecord(
                    item.recordedAt,
                    item.miniKg,
                    item.rabiKg,
                    item.note,
                    req.user.userId
                );
                imported += 1;
            }

            res.json({
                message: `${imported}건의 몸무게 기록을 가져왔습니다.`,
                imported,
                skipped: parsed.skipped || []
            });
        } catch (error) {
            console.error('[API] 고양이 몸무게 엑셀 가져오기 오류:', error);
            res.status(500).json({ message: '엑셀 파일을 처리하지 못했습니다.' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`[Board] 서버가 포트 ${PORT}에서 실행 중입니다.`);
    if (ADMIN_USERNAME) {
        console.log(`[Board] ADMIN_USERNAME: ${ADMIN_USERNAME}`);
    }
});
