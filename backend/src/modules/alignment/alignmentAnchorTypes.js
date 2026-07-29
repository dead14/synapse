const ALIGNMENT_ANCHOR_FEATURE_TYPES = Object.freeze([
    'Weld',
    'Girth Weld',
    'Flange',
    'Joint Flange',
    'Valve',
    'Tee',
    'Tee / Branch Connection',
    'Offtake',
    'Bend',
    'Elbow',
    'Jog',
    'Launcher',
    'Receiver',
]);

const ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL = ALIGNMENT_ANCHOR_FEATURE_TYPES
    .map((featureType) => `'${featureType.replaceAll("'", "''")}'`)
    .join(', ');
const ALIGNMENT_ANCHOR_IDENTIFICATION_PATTERN = 'weld|girth|seam|valve|tee|offtake|branch|bend|elbow|jog|launcher|receiver';

function alignmentAnchorSqlPredicate(featureAlias = 'f') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(featureAlias)) {
        throw new Error('Invalid SQL feature alias');
    }
    return `(
               ${featureAlias}.feature_type IN (${ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL})
               OR (
                   COALESCE(${featureAlias}.feature_type, '') IN ('', 'Other')
                   AND COALESCE(${featureAlias}.feature_identification, '') ~* '(${ALIGNMENT_ANCHOR_IDENTIFICATION_PATTERN})'
               )
           )`;
}

function canonicalAlignmentAnchorType(featureType, featureIdentification = null) {
    const normalizedType = String(featureType || '').trim();
    const normalizedIdentification = String(featureIdentification || '').trim().toLowerCase();
    const useIdentification = !normalizedType || normalizedType.toLowerCase() === 'other';
    const label = (useIdentification ? featureIdentification : normalizedType);
    const normalizedLabel = String(label || '').trim().toLowerCase();

    if (/\bflang(?:e|ed)\b/.test(normalizedType.toLowerCase())
        || /\bflang(?:e|ed)\b/.test(normalizedIdentification)) return 'Flange';
    if (/\bvalve\b/.test(normalizedLabel)) return 'Valve';
    if (/\b(?:tee|offtake|branch connection)\b/.test(normalizedLabel)) return 'Tee';
    if (/\b(?:bend|elbow|jog)\b/.test(normalizedLabel)) return 'Bend';
    if (/\blauncher\b/.test(normalizedLabel)) return 'Launcher';
    if (/\breceiver\b/.test(normalizedLabel)) return 'Receiver';
    if (/\b(?:weld|girth|seam)\b/.test(normalizedLabel)) return 'Weld';
    return null;
}

module.exports = {
    ALIGNMENT_ANCHOR_FEATURE_TYPES,
    ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL,
    alignmentAnchorSqlPredicate,
    canonicalAlignmentAnchorType,
};
