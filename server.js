const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { verifyAuth, canModifyPost, signToken } = require('./middleware');
const { CATEGORIES, isValidCategory, isPhotoCategory } = require('./categories');
const { OWNERS, ASSET_TYPES, isValidOwner, isValidAssetType, getAssetTypeConfig } = require('./asset-categories');
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

        entries.push({ owner, assetType, amountKrw, amountUsd, returnRate });
    }

    return { entries };
}

app.post('/api/auth/register', async (req, res) => {
    try {
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

app.listen(PORT, () => {
    console.log(`[Board] 서버가 포트 ${PORT}에서 실행 중입니다.`);
    if (ADMIN_USERNAME) {
        console.log(`[Board] ADMIN_USERNAME: ${ADMIN_USERNAME}`);
    }
});
