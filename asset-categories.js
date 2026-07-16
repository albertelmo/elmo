const OWNERS = [
    { key: 'jaesik', label: '김재식' },
    { key: 'jieun', label: '임지은' }
];

const ASSET_TYPES = [
    { key: 'domestic', label: '국내투자', hasReturnRate: true, isForeign: false },
    { key: 'foreign', label: '국외투자', hasReturnRate: true, isForeign: true },
    { key: 'coin', label: '코인투자', hasReturnRate: true, isForeign: false },
    { key: 'deposit', label: '예금', hasReturnRate: false, isForeign: false }
];

const OWNER_KEYS = OWNERS.map(owner => owner.key);
const ASSET_TYPE_KEYS = ASSET_TYPES.map(type => type.key);

function isValidOwner(owner) {
    return OWNER_KEYS.includes(owner);
}

function isValidAssetType(assetType) {
    return ASSET_TYPE_KEYS.includes(assetType);
}

function getAssetTypeConfig(assetType) {
    return ASSET_TYPES.find(type => type.key === assetType);
}

module.exports = {
    OWNERS,
    ASSET_TYPES,
    OWNER_KEYS,
    ASSET_TYPE_KEYS,
    isValidOwner,
    isValidAssetType,
    getAssetTypeConfig
};
