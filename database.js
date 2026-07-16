const { Pool, types } = require('pg');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

// DATE 컬럼(OID 1082)을 로컬 타임존 Date로 변환하지 않고 저장된 문자열('YYYY-MM-DD') 그대로 반환한다.
// (그대로 두면 pg가 Date로 파싱 -> JSON 직렬화 시 UTC로 밀리면서 하루가 틀어지는 문제가 생김)
types.setTypeParser(1082, value => value);

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

        await client.query(`
            CREATE TABLE IF NOT EXISTS asset_snapshots (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                recorded_at DATE NOT NULL,
                usd_krw NUMERIC(10, 2) NOT NULL,
                note TEXT,
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS asset_entries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                snapshot_id UUID NOT NULL REFERENCES asset_snapshots(id) ON DELETE CASCADE,
                owner VARCHAR(20) NOT NULL,
                asset_type VARCHAR(20) NOT NULL,
                amount_krw NUMERIC(16, 2) NOT NULL,
                amount_usd NUMERIC(16, 2),
                return_rate NUMERIC(6, 2)
            )
        `);

        await client.query(`
            ALTER TABLE asset_entries ADD COLUMN IF NOT EXISTS label VARCHAR(50)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_asset_entries_snapshot_id ON asset_entries(snapshot_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_asset_snapshots_recorded_at ON asset_snapshots(recorded_at)
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

function formatAssetEntry(row) {
    return {
        id: row.id,
        owner: row.owner,
        asset_type: row.asset_type,
        label: row.label || '',
        amount_krw: Number(row.amount_krw),
        amount_usd: row.amount_usd !== null ? Number(row.amount_usd) : null,
        return_rate: row.return_rate !== null ? Number(row.return_rate) : null
    };
}

function formatAssetSnapshot(row, entries = []) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        recorded_at: row.recorded_at,
        usd_krw: Number(row.usd_krw),
        note: row.note || '',
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        entries: entries.map(formatAssetEntry)
    };
}

async function getAssetSnapshots() {
    const snapshotsResult = await pool.query(`
        SELECT id, recorded_at, usd_krw, note, created_by, created_at, updated_at
        FROM asset_snapshots
        ORDER BY recorded_at ASC, created_at ASC
    `);

    if (snapshotsResult.rows.length === 0) {
        return [];
    }

    const entriesResult = await pool.query(`
        SELECT id, snapshot_id, owner, asset_type, label, amount_krw, amount_usd, return_rate
        FROM asset_entries
        WHERE snapshot_id = ANY($1::uuid[])
    `, [snapshotsResult.rows.map(row => row.id)]);

    const entriesBySnapshot = new Map();
    entriesResult.rows.forEach(entry => {
        const list = entriesBySnapshot.get(entry.snapshot_id) || [];
        list.push(entry);
        entriesBySnapshot.set(entry.snapshot_id, list);
    });

    return snapshotsResult.rows.map(row =>
        formatAssetSnapshot(row, entriesBySnapshot.get(row.id) || [])
    );
}

async function getAssetSnapshotById(id) {
    const snapshotResult = await pool.query(`
        SELECT id, recorded_at, usd_krw, note, created_by, created_at, updated_at
        FROM asset_snapshots
        WHERE id = $1
    `, [id]);

    if (!snapshotResult.rows[0]) {
        return null;
    }

    const entriesResult = await pool.query(`
        SELECT id, snapshot_id, owner, asset_type, label, amount_krw, amount_usd, return_rate
        FROM asset_entries
        WHERE snapshot_id = $1
    `, [id]);

    return formatAssetSnapshot(snapshotResult.rows[0], entriesResult.rows);
}

async function createAssetSnapshot(recordedAt, usdKrw, note, userId, entries) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const snapshotResult = await client.query(`
            INSERT INTO asset_snapshots (recorded_at, usd_krw, note, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, recorded_at, usd_krw, note, created_by, created_at, updated_at
        `, [recordedAt, usdKrw, note, userId]);

        const snapshot = snapshotResult.rows[0];
        const insertedEntries = [];

        for (const entry of entries) {
            const entryResult = await client.query(`
                INSERT INTO asset_entries (snapshot_id, owner, asset_type, label, amount_krw, amount_usd, return_rate)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, snapshot_id, owner, asset_type, label, amount_krw, amount_usd, return_rate
            `, [snapshot.id, entry.owner, entry.assetType, entry.label || null, entry.amountKrw, entry.amountUsd, entry.returnRate]);
            insertedEntries.push(entryResult.rows[0]);
        }

        await client.query('COMMIT');
        return formatAssetSnapshot(snapshot, insertedEntries);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function updateAssetSnapshot(id, recordedAt, usdKrw, note, entries) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const snapshotResult = await client.query(`
            UPDATE asset_snapshots
            SET recorded_at = $1, usd_krw = $2, note = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING id, recorded_at, usd_krw, note, created_by, created_at, updated_at
        `, [recordedAt, usdKrw, note, id]);

        if (!snapshotResult.rows[0]) {
            await client.query('ROLLBACK');
            return null;
        }

        await client.query(`DELETE FROM asset_entries WHERE snapshot_id = $1`, [id]);

        const insertedEntries = [];
        for (const entry of entries) {
            const entryResult = await client.query(`
                INSERT INTO asset_entries (snapshot_id, owner, asset_type, label, amount_krw, amount_usd, return_rate)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, snapshot_id, owner, asset_type, label, amount_krw, amount_usd, return_rate
            `, [id, entry.owner, entry.assetType, entry.label || null, entry.amountKrw, entry.amountUsd, entry.returnRate]);
            insertedEntries.push(entryResult.rows[0]);
        }

        await client.query('COMMIT');
        return formatAssetSnapshot(snapshotResult.rows[0], insertedEntries);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function deleteAssetSnapshot(id) {
    const result = await pool.query(`DELETE FROM asset_snapshots WHERE id = $1`, [id]);
    return result.rowCount > 0;
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
    incrementViews,
    getAssetSnapshots,
    getAssetSnapshotById,
    createAssetSnapshot,
    updateAssetSnapshot,
    deleteAssetSnapshot
};
