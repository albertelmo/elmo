const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'board-dev-secret-change-in-production';

function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '로그인이 필요합니다.' });
    }

    const token = authHeader.slice(7);
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ message: '로그인이 만료되었거나 유효하지 않습니다.' });
    }
}

function canModifyPost(user, post) {
    if (user.role === 'admin') {
        return true;
    }
    if (!post.user_id) {
        return false;
    }
    return post.user_id === user.userId;
}

function signToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

module.exports = {
    verifyAuth,
    canModifyPost,
    signToken,
    JWT_SECRET
};
