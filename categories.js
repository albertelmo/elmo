const CATEGORIES = ['생각들', '사진들', '배움들'];
const PHOTO_CATEGORY = '사진들';

function isValidCategory(category) {
    return CATEGORIES.includes(category);
}

function isPhotoCategory(category) {
    return category === PHOTO_CATEGORY;
}

module.exports = {
    CATEGORIES,
    PHOTO_CATEGORY,
    isValidCategory,
    isPhotoCategory
};
