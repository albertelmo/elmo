const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

db.initializeDatabase();

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await db.getPosts();
        res.json(posts);
    } catch (error) {
        console.error('[API] 게시글 목록 조회 오류:', error);
        res.status(500).json({ message: '게시글 목록을 불러오지 못했습니다.' });
    }
});

app.get('/api/posts/:id', async (req, res) => {
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

app.post('/api/posts', async (req, res) => {
    try {
        const { title, content, author } = req.body;
        
        if (!title || !content || !author) {
            return res.status(400).json({ message: '제목, 내용, 작성자를 모두 입력해주세요.' });
        }
        
        const newPost = await db.createPost(title.trim(), content.trim(), author.trim());
        res.json({ message: '게시글이 작성되었습니다.', post: newPost });
    } catch (error) {
        console.error('[API] 게시글 작성 오류:', error);
        res.status(500).json({ message: '게시글 작성에 실패했습니다.' });
    }
});

app.put('/api/posts/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        const { title, content, author } = req.body;
        
        if (!title || !content || !author) {
            return res.status(400).json({ message: '제목, 내용, 작성자를 모두 입력해주세요.' });
        }
        
        const updatedPost = await db.updatePost(postId, title.trim(), content.trim(), author.trim());
        
        if (!updatedPost) {
            return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
        }
        
        res.json({ message: '게시글이 수정되었습니다.', post: updatedPost });
    } catch (error) {
        console.error('[API] 게시글 수정 오류:', error);
        res.status(500).json({ message: '게시글 수정에 실패했습니다.' });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        const deleted = await db.deletePost(postId);
        
        if (!deleted) {
            return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
        }
        
        res.json({ message: '게시글이 삭제되었습니다.' });
    } catch (error) {
        console.error('[API] 게시글 삭제 오류:', error);
        res.status(500).json({ message: '게시글 삭제에 실패했습니다.' });
    }
});

app.listen(PORT, () => {
    console.log(`[Board] 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
