const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

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
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(50) NOT NULL,
                role VARCHAR(10) NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                author VARCHAR(20) NOT NULL,
                category VARCHAR(20) NOT NULL DEFAULT '생각들',
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                views INTEGER DEFAULT 0
            )
        `);

        await client.query(`
            ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL
        `);

        await client.query(`
            ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT '생각들'
        `);

        await client.query(`
            UPDATE posts SET category = '생각들' WHERE category IS NULL
        `);

        await client.query(`
            ALTER TABLE posts ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb
        `);

        console.log('[DB] 데이터베이스 테이블이 초기화되었습니다.');
        client.release();
    } catch (error) {
        console.error('[DB] 데이터베이스 초기화 오류:', error);
    }
}

async function getUserByUsername(username) {
    const result = await pool.query(
        `SELECT id, username, password_hash, name, role, created_at FROM users WHERE username = $1`,
        [username]
    );
    return result.rows[0];
}

async function getUserById(id) {
    const result = await pool.query(
        `SELECT id, username, name, role, created_at FROM users WHERE id = $1`,
        [id]
    );
    return result.rows[0];
}

async function createUser(username, password, name, role) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
        `INSERT INTO users (username, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, name, role, created_at`,
        [username, passwordHash, name, role]
    );
    return result.rows[0];
}

async function verifyPassword(username, password) {
    const user = await getUserByUsername(username);
    if (!user) {
        return null;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return null;
    }
    return {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
    };
}

function formatPost(row) {
    if (!row) {
        return null;
    }
    return {
        ...row,
        images: Array.isArray(row.images) ? row.images : []
    };
}

async function getPosts(category) {
    let query = `
        SELECT id, title, content, author, category, user_id, images, created_at, updated_at, views
        FROM posts
    `;
    const params = [];

    if (category) {
        query += ` WHERE category = $1`;
        params.push(category);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    return result.rows.map(formatPost);
}

async function getPostById(id) {
    const result = await pool.query(`
        SELECT id, title, content, author, category, user_id, images, created_at, updated_at, views
        FROM posts
        WHERE id = $1
    `, [id]);
    return formatPost(result.rows[0]);
}

async function createPost(title, content, author, userId, category, images = []) {
    const result = await pool.query(`
        INSERT INTO posts (title, content, author, user_id, category, images)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING id, title, content, author, category, user_id, images, created_at, updated_at, views
    `, [title, content, author, userId, category, JSON.stringify(images)]);
    return formatPost(result.rows[0]);
}

async function updatePost(id, title, content, category, images = []) {
    const result = await pool.query(`
        UPDATE posts
        SET title = $1, content = $2, category = $3, images = $4::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING id, title, content, author, category, user_id, images, created_at, updated_at, views
    `, [title, content, category, JSON.stringify(images), id]);
    return formatPost(result.rows[0]);
}

async function deletePost(id) {
    const result = await pool.query(`DELETE FROM posts WHERE id = $1`, [id]);
    return result.rowCount > 0;
}

async function incrementViews(id) {
    await pool.query(`UPDATE posts SET views = views + 1 WHERE id = $1`, [id]);
}

module.exports = {
    initializeDatabase,
    getUserByUsername,
    getUserById,
    createUser,
    verifyPassword,
    getPosts,
    getPostById,
    createPost,
    updatePost,
    deletePost,
    incrementViews
};
