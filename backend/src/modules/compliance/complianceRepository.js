async function listOwnedRequirements(pool, orgId) {
    const result = await pool.query(
        `SELECT r.id, r.code, r.title, r.edition, r.category, r.requirement_text,
                r.source_reference, r.active,
                COUNT(l.id) FILTER (WHERE l.status = 'accepted') AS accepted_links,
                COUNT(l.id) FILTER (WHERE l.status <> 'not_applicable') AS applicable_links
         FROM compliance_requirements r
         LEFT JOIN compliance_evidence_links l ON l.requirement_id = r.id
         WHERE r.organization_id = $1 AND r.active = TRUE
         GROUP BY r.id
         ORDER BY r.category, r.code
         LIMIT 500`,
        [orgId],
    );
    return result.rows;
}

async function createOwnedRequirement(pool, orgId, input) {
    const result = await pool.query(
        `INSERT INTO compliance_requirements
            (organization_id, code, title, edition, category, requirement_text, source_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [orgId, input.code, input.title, input.edition, input.category,
            input.requirementText, input.sourceReference],
    );
    return result.rows[0];
}

module.exports = { createOwnedRequirement, listOwnedRequirements };
