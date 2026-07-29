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
    'Bend / Elbow',
    'Elbow',
    'Jog',
    'Launcher',
    'Receiver',
]);

const ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL = ALIGNMENT_ANCHOR_FEATURE_TYPES
    .map((featureType) => `'${featureType.replaceAll("'", "''")}'`)
    .join(', ');
const ALIGNMENT_ANCHOR_NORMALIZED_FEATURE_TYPE_SQL = ALIGNMENT_ANCHOR_FEATURE_TYPES
    .map((featureType) => `'${featureType.toLowerCase().replaceAll("'", "''")}'`)
    .join(', ');
const ALIGNMENT_ANCHOR_FEATURE_TYPE_KEYS = new Set(
    ALIGNMENT_ANCHOR_FEATURE_TYPES.map((featureType) => featureType.toLowerCase()),
);
const ALIGNMENT_ANCHOR_QUALIFIED_LABEL_SQL_PATTERN = '^[[:space:]]*((pipeline|pipe|field|shop|girth|long|longitudinal|circumferential|spiral)[[:space:]-]+)?(weld|seam|valve|tee|offtake|branch([[:space:]]+connection)?|bend|elbow|jog|flang(e|ed)|launcher|receiver)([[:space:]/-]+(begin|end|left|right|upstream|downstream|weld|joint|no[.]?|number|[0-9]+([.][0-9]+)?([[:space:]]*(deg|degree|degrees))?))*[[:space:]]*$';
const ALIGNMENT_GENERIC_FEATURE_TYPE_PATTERN = '^[[:space:]]*(other|fitting|component|pipeline[[:space:]]+(component|feature)|physical[[:space:]]+feature|component[[:space:]]*[(]general[)]|unknown|unclassified)?[[:space:]]*$';
const ALIGNMENT_ANOMALY_TOKEN_SQL_PATTERN = '(^|[^[:alnum:]_])(metal[[:space:]_-]+loss|corrosion|anomal(y|ies)?|dent|crack|gouge)([^[:alnum:]_]|$)';
const ALIGNMENT_ANCHOR_QUALIFIED_LABEL_PATTERN = /^(?:(?:pipeline|pipe|field|shop|girth|long|longitudinal|circumferential|spiral)[\s-]+)?(?:weld|seam|valve|tee|offtake|branch(?:\s+connection)?|bend|elbow|jog|flang(?:e|ed)|launcher|receiver)(?:[\s/-]+(?:begin|end|left|right|upstream|downstream|weld|joint|no\.?|number|\d+(?:\.\d+)?(?:\s*(?:deg|degree|degrees))?))*$/i;

function alignmentAnchorSqlPredicate(featureAlias = 'f') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(featureAlias)) {
        throw new Error('Invalid SQL feature alias');
    }
    return `(
               LOWER(BTRIM(COALESCE(${featureAlias}.feature_type, ''))) IN (${ALIGNMENT_ANCHOR_NORMALIZED_FEATURE_TYPE_SQL})
               OR (
                   COALESCE(${featureAlias}.feature_type, '') ~* '${ALIGNMENT_ANCHOR_QUALIFIED_LABEL_SQL_PATTERN}'
                   AND COALESCE(${featureAlias}.feature_type, '') !~* '${ALIGNMENT_ANOMALY_TOKEN_SQL_PATTERN}'
               )
               OR (
                   COALESCE(${featureAlias}.feature_type, '') ~* '${ALIGNMENT_GENERIC_FEATURE_TYPE_PATTERN}'
                   AND (
                       LOWER(BTRIM(COALESCE(${featureAlias}.feature_identification, ''))) IN (${ALIGNMENT_ANCHOR_NORMALIZED_FEATURE_TYPE_SQL})
                       OR COALESCE(${featureAlias}.feature_identification, '') ~* '${ALIGNMENT_ANCHOR_QUALIFIED_LABEL_SQL_PATTERN}'
                   )
                   AND COALESCE(${featureAlias}.feature_identification, '') !~* '${ALIGNMENT_ANOMALY_TOKEN_SQL_PATTERN}'
               )
           )`;
}

function canonicalAlignmentAnchorType(featureType, featureIdentification = null) {
    const normalizedType = String(featureType || '').trim();
    const normalizedTypeLower = normalizedType.toLowerCase().replace(/\s+/g, ' ');
    const normalizedIdentification = String(featureIdentification || '').trim().toLowerCase();
    const isPersistedCanonicalType = ALIGNMENT_ANCHOR_FEATURE_TYPE_KEYS.has(normalizedTypeLower);
    const useIdentification = !normalizedType
        || /^(?:other|fitting|component|component \(general\)|pipeline (?:component|feature)|physical feature|unknown|unclassified)$/.test(normalizedTypeLower);
    const label = (useIdentification ? featureIdentification : normalizedType);
    const normalizedLabel = String(label || '').trim().toLowerCase();
    const isKnownAnchorLabel = ALIGNMENT_ANCHOR_FEATURE_TYPE_KEYS.has(normalizedLabel)
        || ALIGNMENT_ANCHOR_QUALIFIED_LABEL_PATTERN.test(normalizedLabel);

    if (!isPersistedCanonicalType
        && /\b(?:metal[\s_-]+loss|corrosion|anomal(?:y|ies)?|dent|crack|gouge)\b/.test(normalizedLabel)) {
        return null;
    }
    if (!isPersistedCanonicalType && !isKnownAnchorLabel) return null;
    if (/\bflang(?:e|ed)\b/.test(normalizedTypeLower)
        || ((useIdentification || isPersistedCanonicalType)
            && /\bflang(?:e|ed)\b/.test(normalizedIdentification))) return 'Flange';
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
