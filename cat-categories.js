const CATS = [
    { key: 'mini', label: '미니', color: '#ed8936' },
    { key: 'rabi', label: '라비', color: '#2dd4bf' }
];

function isValidCat(key) {
    return CATS.some(cat => cat.key === key);
}

function getCatConfig(key) {
    return CATS.find(cat => cat.key === key);
}

function getCatLabel(key) {
    const cat = getCatConfig(key);
    return cat ? cat.label : key;
}

module.exports = {
    CATS,
    isValidCat,
    getCatConfig,
    getCatLabel
};
