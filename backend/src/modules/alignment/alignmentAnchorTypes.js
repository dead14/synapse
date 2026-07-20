const ALIGNMENT_ANCHOR_FEATURE_TYPES = Object.freeze([
    'Weld',
    'Girth Weld',
    'Valve',
    'Tee',
    'Tee / Branch Connection',
    'Offtake',
    'Bend',
    'Launcher',
    'Receiver',
]);

const ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL = ALIGNMENT_ANCHOR_FEATURE_TYPES
    .map((featureType) => `'${featureType.replaceAll("'", "''")}'`)
    .join(', ');

function canonicalAlignmentAnchorType(featureType, featureIdentification = null) {
    const normalizedType = String(featureType || '').trim();
    const useIdentification = !normalizedType || normalizedType.toLowerCase() === 'other';
    const label = (useIdentification ? featureIdentification : normalizedType);
    const normalizedLabel = String(label || '').trim().toLowerCase();

    if (/\bvalve\b/.test(normalizedLabel)) return 'Valve';
    if (/\b(?:tee|offtake|branch connection)\b/.test(normalizedLabel)) return 'Tee';
    if (/\b(?:bend|elbow)\b/.test(normalizedLabel)) return 'Bend';
    if (/\blauncher\b/.test(normalizedLabel)) return 'Launcher';
    if (/\breceiver\b/.test(normalizedLabel)) return 'Receiver';
    if (/\b(?:weld|girth|seam)\b/.test(normalizedLabel)) return 'Weld';
    return null;
}

module.exports = {
    ALIGNMENT_ANCHOR_FEATURE_TYPES,
    ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL,
    canonicalAlignmentAnchorType,
};
