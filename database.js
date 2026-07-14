const { Pool } = require('pg');

// Render: DATABASE_URL 사용 / 로컬: 개별 환경변수 또는 기본값
const pool = process.env.DATABASE_URL
    ? new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      })
    : new Pool({
          user: process.env.DB_USER || 'board_user',
          host: process.env.DB_HOST || 'localhost',
          database: process.env.DB_NAME || 'board',
          password: process.env.DB_PASSWORD || 'board123',
          port: Number(process.env.DB_PORT) || 5432,
      });

async function initializeDatabase() {
    try {
        const client = await pool.connect();

        await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                author VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                views INTEGER DEFAULT 0
            )
        `);

        console.log('[DB] 데이터베이스 테이블이 초기화되었습니다.');
        client.release();
    } catch (error) {
        console.error('[DB] 데이터베이스 초기화 오류:', error);
    }
}

async function getPosts() {
    try {
        const result = await pool.query(`
            SELECT id, title, content, author, created_at, updated_at, views
            FROM posts 
            ORDER BY created_at DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('[DB] 게시글 목록 조회 오류:', error);
        throw error;
    }
}

async function getPostById(id) {
    try {
        const result = await pool.query(`
            SELECT id, title, content, author, created_at, updated_at, views
            FROM posts 
            WHERE id = $1
        `, [id]);
        return result.rows[0];
    } catch (error) {
        console.error('[DB] 게시글 상세 조회 오류:', error);
        throw error;
    }
}

async function createPost(title, content, author) {
    try {
        const result = await pool.query(`
            INSERT INTO posts (title, content, author)
            VALUES ($1, $2, $3)
            RETURNING id, title, content, author, created_at, updated_at, views
        `, [title, content, author]);
        return result.rows[0];
    } catch (error) {
        console.error('[DB] 게시글 작성 오류:', error);
        throw error;
    }
}

async function updatePost(id, title, content, author) {
    try {
        const result = await pool.query(`
            UPDATE posts 
            SET title = $1, content = $2, author = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING id, title, content, author, created_at, updated_at, views
        `, [title, content, author, id]);
        return result.rows[0];
    } catch (error) {
        console.error('[DB] 게시글 수정 오류:', error);
        throw error;
    }
}

async function deletePost(id) {
    try {
        const result = await pool.query(`
            DELETE FROM posts 
            WHERE id = $1
        `, [id]);
        return result.rowCount > 0;
    } catch (error) {
        console.error('[DB] 게시글 삭제 오류:', error);
        throw error;
    }
}

async function incrementViews(id) {
    try {
        await pool.query(`
            UPDATE posts 
            SET views = views + 1
            WHERE id = $1
        `, [id]);
    } catch (error) {
        console.error('[DB] 조회수 증가 오류:', error);
        throw error;
    }
}

module.exports = {
    initializeDatabase,
    getPosts,
    getPostById,
    createPost,
    updatePost,
    deletePost,
    incrementViews
};
