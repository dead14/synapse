"""
pipeline_service.py — Orkestrasi Pipeline Filogenesis
=====================================================
Service layer yang mengorkestrasi seluruh flow filogenesis:
- Load ancestor dari DB
- Panggil semua fase di filogenesis_core.py per blok
- Tulis hasil ke DB (canonical_anchors, alignment_links)
- Rebase chain jika ada canonical baru

Fungsi utama: run_phylogenetic_alignment() dan rebase()
"""

import numpy as np
import logging
import time
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import asdict

from .filogenesis_core import (
    AncestralAnchor,
    Feature,
    MatchResult,
    BlockResult,
    AlignmentReport,
    ransac_linear_fit,
    compute_anchor_weights,
    partition_into_blocks,
    process_block_dtw,
    hungarian_matching_with_prior,
    compute_canonical_updates,
    validate_physical_constraints,
    kalman_update_chainage,
)

logger = logging.getLogger("phylogenesis.pipeline")


# ===========================================================================
# FASE 0: LOAD ANCESTOR
# ===========================================================================

def load_ancestral_anchors(
    db_conn: Any,
    source_run_id: int,
    confidence_threshold: float = 0.85
) -> List[AncestralAnchor]:
    """
    Muat semua ancestral anchors dari database untuk source_run_id tertentu.
    
    Query alignment_links dimana is_outlier=False dan confidence > threshold,
    join ke canonical_anchors untuk mendapatkan pasangan
    (odom_source, abs_chainage, sigma, confidence, is_golden).
    
    Parameter:
        db_conn: Koneksi database (object yang punya method execute & fetchall)
        source_run_id: ID dari ILI run yang sudah punya link ke canonical
        confidence_threshold: Minimum confidence untuk diterima (default 0.85)
    
    Return:
        List of AncestralAnchor (raw_ancestral_anchors)
    """
    query = """
        SELECT 
            ca.id AS canonical_id,
            al.odometer AS odom_source,
            ca.abs_chainage,
            ca.sigma,
            ca.confidence,
            ca.is_golden,
            ca.anchor_type,
            al.confidence AS link_confidence,
            (SELECT ir_src.survey_year FROM survey_runs ir_src WHERE ir_src.id = %s) - 
            (SELECT ir_orig.survey_year FROM survey_runs ir_orig 
             JOIN alignment_links al_orig ON al_orig.ili_run_id = ir_orig.id 
             WHERE al_orig.canonical_id = ca.id 
             ORDER BY ir_orig.survey_year ASC LIMIT 1) AS generation_age
        FROM alignment_links al
        JOIN canonical_anchors ca ON al.canonical_id = ca.id
        WHERE al.ili_run_id = %s
          AND al.is_outlier = FALSE
          AND al.confidence > %s
        ORDER BY ca.abs_chainage
    """
    
    cursor = db_conn.cursor()
    cursor.execute(query, (source_run_id, source_run_id, confidence_threshold))
    rows = cursor.fetchall()
    
    anchors = []
    for row in rows:
        anchors.append(AncestralAnchor(
            canonical_id=row[0],
            odom_source=row[1],
            abs_chainage=row[2],
            sigma=row[3],
            confidence=row[4],
            is_golden=row[5],
            anchor_type=row[6],
            link_confidence=row[7],
            generation_age=max(row[8] or 0, 0)
        ))
    
    logger.info(
        "Loaded %d raw ancestral anchors untuk source_run_id=%d (threshold=%.2f)",
        len(anchors), source_run_id, confidence_threshold
    )
    
    return anchors


def load_features(
    db_conn: Any,
    ili_run_id: int
) -> List[Feature]:
    """
    Muat semua fitur dari database untuk satu ILI run.
    
    Parameter:
        db_conn: Koneksi database
        ili_run_id: ID dari ILI run
    
    Return:
        List of Feature, terurut berdasarkan odometer
    """
    query = """
        SELECT id, run_id, feature_type, log_distance_m, NULL
        FROM ili_features
        WHERE run_id = %s
        ORDER BY log_distance_m
    """
    
    cursor = db_conn.cursor()
    cursor.execute(query, (ili_run_id,))
    rows = cursor.fetchall()
    
    features = []
    for row in rows:
        features.append(Feature(
            id=row[0],
            ili_run_id=row[1],
            feature_type=row[2],
            odometer=row[3],
            metadata=row[4] or {}
        ))
    
    logger.info("Loaded %d features untuk ili_run_id=%d", len(features), ili_run_id)
    return features


# ===========================================================================
# DB WRITERS
# ===========================================================================

def update_outliers_in_db(
    db_conn: Any,
    outlier_canonical_ids: List[int],
    source_run_id: int
):
    """
    Tandai alignment_links sebagai outlier di database.
    
    Parameter:
        db_conn: Koneksi database
        outlier_canonical_ids: List canonical_id yang terdeteksi outlier oleh RANSAC
        source_run_id: ILI run yang sedang di-cek
    """
    if not outlier_canonical_ids:
        return
    
    cursor = db_conn.cursor()
    placeholders = ','.join(['%s'] * len(outlier_canonical_ids))
    query = f"""
        UPDATE alignment_links 
        SET is_outlier = TRUE 
        WHERE ili_run_id = %s 
          AND canonical_id IN ({placeholders})
    """
    cursor.execute(query, [source_run_id] + outlier_canonical_ids)
    db_conn.commit()
    
    logger.info(
        "Updated %d outliers di alignment_links untuk run %d",
        len(outlier_canonical_ids), source_run_id
    )


def write_canonical_and_links(
    db_conn: Any,
    updates: List[Dict[str, Any]],
    target_run_id: int,
    features_target: List[Feature],
    job_id: int,
    pipeline_id: int
):
    """
    Tulis canonical anchors baru/update dan alignment_links ke database.
    
    Parameter:
        db_conn: Koneksi database
        updates: Output dari compute_canonical_updates
        target_run_id: ILI run target
        features_target: Fitur target (untuk lookup odometer)
        job_id: Job ID saat ini
        pipeline_id: ID pipeline
    """
    cursor = db_conn.cursor()
    
    for upd in updates:
        target_feat = None
        for f in features_target:
            if f.id == upd['target_feature_id']:
                target_feat = f
                break
        
        if target_feat is None:
            continue
        
        if upd['action'] == 'INSERT':
            # Insert canonical baru
            cursor.execute("""
                INSERT INTO canonical_anchors 
                    (pipeline_id, abs_chainage, sigma, confidence, is_golden, anchor_type)
                VALUES (%s, %s, %s, %s, FALSE, %s)
                RETURNING id
            """, (
                pipeline_id,
                upd['abs_chainage'],
                upd['sigma'],
                upd['confidence'],
                upd['anchor_type']
            ))
            canonical_id = cursor.fetchone()[0]
            
        elif upd['action'] == 'UPDATE':
            # Update canonical existing
            cursor.execute("""
                UPDATE canonical_anchors 
                SET abs_chainage = %s, sigma = %s, confidence = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT canonical_id FROM alignment_links 
                    WHERE ili_run_id = %s 
                    ORDER BY ABS(odometer - %s) LIMIT 1
                )
                RETURNING id
            """, (
                upd['abs_chainage'],
                upd['sigma'],
                upd['confidence'],
                target_run_id,
                target_feat.odometer
            ))
            result = cursor.fetchone()
            canonical_id = result[0] if result else None
        
        if canonical_id:
            # Insert alignment_link
            cursor.execute("""
                INSERT INTO alignment_links 
                    (canonical_id, ili_run_id, odometer, confidence, source_job_id, is_outlier)
                VALUES (%s, %s, %s, %s, %s, FALSE)
            """, (
                canonical_id,
                target_run_id,
                target_feat.odometer,
                upd['confidence'],
                job_id
            ))
    
    db_conn.commit()
    logger.info(
        "Wrote %d canonical updates + links untuk target_run=%d, job=%d",
        len(updates), target_run_id, job_id
    )


def create_alignment_job(
    db_conn: Any,
    pipeline_id: int,
    source_run_id: int,
    target_run_id: int
) -> int:
    """
    Buat entry alignment_jobs baru dan kembalikan job_id.
    
    Parameter:
        db_conn: Koneksi database
        pipeline_id: ID pipeline
        source_run_id: ILI run sumber
        target_run_id: ILI run target
    
    Return:
        job_id (int)
    """
    cursor = db_conn.cursor()
    cursor.execute("""
        INSERT INTO alignment_sessions 
            (pipeline_id, run_old_id, run_new_id, status)
        VALUES (%s, %s, %s, 'running')
        RETURNING id
    """, (pipeline_id, source_run_id, target_run_id))
    job_id = cursor.fetchone()[0]
    db_conn.commit()
    
    logger.info("Created alignment job %d: run %d -> run %d", job_id, source_run_id, target_run_id)
    return job_id


def finalize_job(
    db_conn: Any,
    job_id: int,
    report: AlignmentReport,
    status: str = 'completed'
):
    """
    Update status dan summary alignment_jobs setelah selesai.
    
    Parameter:
        db_conn: Koneksi database
        job_id: ID job
        report: Laporan hasil alignment
        status: Status akhir ('completed' atau 'failed')
    """
    import json
    
    summary = {
        'ransac_inliers': report.ransac_inliers,
        'ransac_outliers': report.ransac_outliers,
        'total_blocks': report.total_blocks,
        'fallback_blocks': report.fallback_blocks,
        'corrupt_blocks': report.corrupt_blocks,
        'suspect_spool_blocks': report.suspect_spool_blocks,
        'joint_violations': report.joint_violations,
        'total_matches': report.total_matches,
        'physically_impossible_joints': report.physically_impossible_joints,
        'outlier_canonical_ids': report.outlier_anchors
    }
    
    cursor = db_conn.cursor()
    cursor.execute("""
        UPDATE alignment_sessions 
        SET status = %s, params_json = %s, completed_at = CURRENT_TIMESTAMP
        WHERE id = %s
    """, (status, json.dumps(summary), job_id))
    db_conn.commit()
    
    logger.info("Job %d finalized: status=%s", job_id, status)


# ===========================================================================
# MAIN ORCHESTRATOR
# ===========================================================================

def run_phylogenetic_alignment(
    db_conn: Any,
    pipeline_id: int,
    source_run_id: int,
    target_run_id: int,
    signal_source: np.ndarray,
    signal_target: np.ndarray,
    sampling_interval: float = 0.1,
    ransac_iters: int = 150,
    ransac_tolerance: float = 0.6,
    confidence_threshold: float = 0.85,
    sakoe_chiba_band: Optional[int] = None
) -> AlignmentReport:
    """
    Orkestrasi lengkap alignment filogenesis dari Fase 0 sampai Fase 7.
    
    Ini adalah entry point utama yang memanggil seluruh pipeline:
    0. Load ancestor
    1. RANSAC sanitization
    2. Confidence decay & weighting
    3. Block partitioning
    4. Anchor-constrained DTW (per blok)
    5. Hungarian matching dengan prior (per blok)
    6. Canonical update & graph rebase
    7. Validasi fisik otomatis
    
    Parameter:
        db_conn: Koneksi database
        pipeline_id: ID pipeline
        source_run_id: ID ILI run sumber (sudah punya canonical links)
        target_run_id: ID ILI run target (belum punya)
        signal_source: Sinyal MFL source (1D array resampled per sampling_interval)
        signal_target: Sinyal MFL target (1D array resampled per sampling_interval)
        sampling_interval: Interval sampling sinyal (meter, default 0.1)
        ransac_iters: Jumlah iterasi RANSAC (default 150)
        ransac_tolerance: Toleransi RANSAC (meter, default 0.6)
        confidence_threshold: Minimum confidence untuk ancestral anchor (default 0.85)
        sakoe_chiba_band: Lebar Sakoe-Chiba band (opsional)
    
    Return:
        AlignmentReport dengan seluruh statistik dan hasil
    """
    start_time = time.time()
    
    # Buat job record
    job_id = create_alignment_job(db_conn, pipeline_id, source_run_id, target_run_id)
    report = AlignmentReport(job_id=job_id)
    
    try:
        # =====================================================================
        # FASE 0: LOAD ANCESTOR
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 0: LOAD ANCESTOR (source_run=%d)", source_run_id)
        logger.info("=" * 60)
        
        raw_anchors = load_ancestral_anchors(db_conn, source_run_id, confidence_threshold)
        
        if len(raw_anchors) < 2:
            logger.error("Terlalu sedikit anchor (%d). Butuh minimal 2.", len(raw_anchors))
            finalize_job(db_conn, job_id, report, status='failed')
            return report
        
        # =====================================================================
        # FASE 1: RANSAC ANCESTRAL SANITIZATION
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 1: RANSAC ANCESTRAL SANITIZATION")
        logger.info("=" * 60)
        
        inliers, outliers, scale, offset = ransac_linear_fit(
            raw_anchors,
            n_iters=ransac_iters,
            tolerance=ransac_tolerance
        )
        
        report.ransac_inliers = len(inliers)
        report.ransac_outliers = len(outliers)
        report.outlier_anchors = [o.canonical_id for o in outliers]
        
        # Update DB: tandai outliers
        update_outliers_in_db(
            db_conn,
            [o.canonical_id for o in outliers],
            source_run_id
        )
        
        if len(inliers) < 2:
            logger.error("Setelah RANSAC, hanya %d inlier tersisa. Abort.", len(inliers))
            finalize_job(db_conn, job_id, report, status='failed')
            return report
        
        # =====================================================================
        # FASE 2: CONFIDENCE DECAY & WEIGHTING
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 2: CONFIDENCE DECAY & WEIGHTING")
        logger.info("=" * 60)
        
        weighted_anchors = compute_anchor_weights(inliers)
        
        # =====================================================================
        # FASE 3: BLOCK PARTITIONING
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 3: BLOCK PARTITIONING")
        logger.info("=" * 60)
        
        blocks = partition_into_blocks(weighted_anchors)
        report.total_blocks = len(blocks)
        
        if not blocks:
            logger.error("Tidak ada blok yang dihasilkan. Abort.")
            finalize_job(db_conn, job_id, report, status='failed')
            return report
        
        # Load features
        features_source = load_features(db_conn, source_run_id)
        features_target = load_features(db_conn, target_run_id)
        
        # =====================================================================
        # FASE 4 & 5: DTW + HUNGARIAN PER BLOK
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 4 & 5: DTW + HUNGARIAN PER BLOK (%d blok)", len(blocks))
        logger.info("=" * 60)
        
        all_matches: List[MatchResult] = []
        all_updates: List[Dict[str, Any]] = []
        
        for block_idx, block in enumerate(blocks):
            logger.info(
                "--- Blok %d/%d: %.1fm - %.1fm (%d anchors) ---",
                block_idx + 1, len(blocks),
                block['start_abs'], block['end_abs'],
                len(block['anchors'])
            )
            
            # Konversi batas blok ke indeks sinyal
            src_start_idx = int(block['start_abs'] / sampling_interval)
            src_end_idx = int(block['end_abs'] / sampling_interval)
            
            # Estimasi batas target (gunakan RANSAC scale/offset)
            tgt_start_abs = (block['start_abs'] - offset) / max(scale, 0.001)
            tgt_end_abs = (block['end_abs'] - offset) / max(scale, 0.001)
            tgt_start_idx = int(tgt_start_abs / sampling_interval)
            tgt_end_idx = int(tgt_end_abs / sampling_interval)
            
            # Clamp ke batas sinyal
            src_start_idx = max(0, min(src_start_idx, len(signal_source) - 1))
            src_end_idx = max(src_start_idx + 1, min(src_end_idx, len(signal_source)))
            tgt_start_idx = max(0, min(tgt_start_idx, len(signal_target) - 1))
            tgt_end_idx = max(tgt_start_idx + 1, min(tgt_end_idx, len(signal_target)))
            
            sig_src_block = signal_source[src_start_idx:src_end_idx]
            sig_tgt_block = signal_target[tgt_start_idx:tgt_end_idx]
            
            if len(sig_src_block) < 10 or len(sig_tgt_block) < 10:
                logger.warning("Blok %d terlalu kecil, skip", block_idx)
                continue
            
            # Bangun anchor constraints untuk blok ini
            anchor_constraints = []
            for anchor, weight, sigma in block['anchors']:
                local_src_idx = int((anchor.odom_source - block['start_abs']) / sampling_interval)
                local_src_idx = max(0, min(local_src_idx, len(sig_src_block) - 1))
                
                # Estimasi target idx via RANSAC model
                tgt_odom_est = (anchor.abs_chainage - offset) / max(scale, 0.001)
                local_tgt_idx = int((tgt_odom_est - tgt_start_abs) / sampling_interval)
                local_tgt_idx = max(0, min(local_tgt_idx, len(sig_tgt_block) - 1))
                
                anchor_constraints.append((local_src_idx, local_tgt_idx, sigma))
            
            # FASE 4: DTW
            path, dtw_cost, is_corrupt, need_review = process_block_dtw(
                sig_src_block,
                sig_tgt_block,
                anchor_constraints,
                sampling_interval,
                sakoe_chiba_band
            )
            
            block_result = BlockResult(
                block_idx=block_idx,
                start_abs=block['start_abs'],
                end_abs=block['end_abs'],
                matches=[],
                warping_path=path,
                is_corrupt=is_corrupt,
                need_manual_review=need_review,
                mean_dtw_cost=dtw_cost / max(len(path), 1) if path else 0
            )
            
            if is_corrupt:
                report.corrupt_blocks += 1
            if need_review:
                report.fallback_blocks += 1
            
            if not path:
                report.block_results.append(block_result)
                continue
            
            # Filter features yang ada di blok ini
            block_feat_src = [
                f for f in features_source
                if block['start_abs'] <= f.odometer < block['end_abs']
            ]
            block_feat_tgt = [
                f for f in features_target
                if tgt_start_abs <= f.odometer < tgt_end_abs
            ]
            
            # FASE 5: Hungarian
            block_matches = hungarian_matching_with_prior(
                block_feat_src,
                block_feat_tgt,
                path,
                block['anchors'],
                source_odom_start=block['start_abs'],
                target_odom_start=tgt_start_abs,
                sampling_interval=sampling_interval
            )
            
            block_result.matches = block_matches
            all_matches.extend(block_matches)
            report.block_results.append(block_result)
            
            # FASE 6: Canonical updates untuk blok ini
            block_updates = compute_canonical_updates(
                block_matches,
                block_feat_tgt,
                path,
                block['anchors']
            )
            all_updates.extend(block_updates)
        
        # =====================================================================
        # FASE 6: WRITE TO DB
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 6: CANONICAL UPDATE & DB WRITE")
        logger.info("=" * 60)
        
        write_canonical_and_links(
            db_conn, all_updates, target_run_id, features_target, job_id, pipeline_id
        )
        
        report.total_matches = len(all_matches)
        
        # =====================================================================
        # FASE 7: VALIDASI FISIK
        # =====================================================================
        logger.info("=" * 60)
        logger.info("FASE 7: VALIDASI FISIK OTOMATIS")
        logger.info("=" * 60)
        
        # Ambil semua canonical anchor yang baru di-update
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT id, abs_chainage, anchor_type FROM canonical_anchors 
            WHERE pipeline_id = %s ORDER BY abs_chainage
        """, (pipeline_id,))
        
        all_canonicals = [
            {'id': r[0], 'abs_chainage': r[1], 'anchor_type': r[2]}
            for r in cursor.fetchall()
        ]
        
        violations, suspect_blocks = validate_physical_constraints(
            all_canonicals,
            report.block_results
        )
        
        report.joint_violations = len(violations)
        report.physically_impossible_joints = violations
        report.suspect_spool_blocks = len(suspect_blocks)
        
        # Finalize
        finalize_job(db_conn, job_id, report, status='completed')
        
        elapsed = time.time() - start_time
        logger.info("=" * 60)
        logger.info("ALIGNMENT SELESAI dalam %.1f detik", elapsed)
        logger.info("  Inliers RANSAC: %d | Outliers: %d", report.ransac_inliers, report.ransac_outliers)
        logger.info("  Total blok: %d | Fallback: %d | Corrupt: %d", report.total_blocks, report.fallback_blocks, report.corrupt_blocks)
        logger.info("  Total matches: %d", report.total_matches)
        logger.info("  Joint violations: %d | Suspect spools: %d", report.joint_violations, report.suspect_spool_blocks)
        logger.info("=" * 60)
        
        return report
        
    except Exception as e:
        logger.exception("FATAL ERROR pada alignment job %d: %s", job_id, str(e))
        finalize_job(db_conn, job_id, report, status='failed')
        raise


# ===========================================================================
# REBASE FUNCTION
# ===========================================================================

def rebase(
    db_conn: Any,
    canonical_id_baru: int,
    signal_cache: Optional[Dict[int, np.ndarray]] = None,
    sampling_interval: float = 0.1
) -> List[int]:
    """
    Re-trigger alignment filogenesis untuk semua job yang bergantung
    pada canonical_id_baru.
    
    Cari semua alignment_jobs yang dependen melalui:
    alignment_links.source_job_id -> alignment_jobs.id
    
    Untuk setiap job dependen, re-run alignment filogenesis.
    
    Parameter:
        db_conn: Koneksi database
        canonical_id_baru: ID canonical anchor yang berubah
        signal_cache: Cache sinyal per run_id {run_id: np.ndarray} (opsional)
        sampling_interval: Interval sampling sinyal
    
    Return:
        List of job_ids yang di-re-trigger
    """
    cursor = db_conn.cursor()
    
    # Cari semua alignment_links yang reference canonical ini
    cursor.execute("""
        SELECT DISTINCT al.source_job_id
        FROM alignment_links al
        WHERE al.canonical_id = %s
          AND al.source_job_id IS NOT NULL
    """, (canonical_id_baru,))
    
    dependent_job_ids = [row[0] for row in cursor.fetchall()]
    
    if not dependent_job_ids:
        logger.info("Tidak ada job dependen untuk canonical_id=%d", canonical_id_baru)
        return []
    
    logger.info(
        "Rebase: canonical_id=%d mempengaruhi %d job(s): %s",
        canonical_id_baru, len(dependent_job_ids), dependent_job_ids
    )
    
    retriggered_jobs = []
    
    for dep_job_id in dependent_job_ids:
        # Ambil info job
        cursor.execute("""
            SELECT pipeline_id, run_old_id, run_new_id
            FROM alignment_sessions
            WHERE id = %s
        """, (dep_job_id,))
        
        job_info = cursor.fetchone()
        if not job_info:
            continue
        
        pipeline_id, source_run_id, target_run_id = job_info
        
        logger.info(
            "Re-triggering job %d: run %d -> run %d",
            dep_job_id, source_run_id, target_run_id
        )
        
        # Load sinyal (dari cache atau biarkan caller yang provide)
        if signal_cache and source_run_id in signal_cache and target_run_id in signal_cache:
            signal_src = signal_cache[source_run_id]
            signal_tgt = signal_cache[target_run_id]
            
            new_report = run_phylogenetic_alignment(
                db_conn=db_conn,
                pipeline_id=pipeline_id,
                source_run_id=source_run_id,
                target_run_id=target_run_id,
                signal_source=signal_src,
                signal_target=signal_tgt,
                sampling_interval=sampling_interval
            )
            retriggered_jobs.append(new_report.job_id)
        else:
            logger.warning(
                "Sinyal untuk run %d dan/atau %d tidak tersedia di cache. "
                "Job %d ditandai untuk re-run manual.",
                source_run_id, target_run_id, dep_job_id
            )
            # Tandai job lama sebagai pending rebase
            cursor.execute("""
                UPDATE alignment_sessions 
                SET status = 'pending_rebase'
                WHERE id = %s
            """, (dep_job_id,))
            db_conn.commit()
    
    logger.info("Rebase selesai. %d job di-re-trigger.", len(retriggered_jobs))
    return retriggered_jobs
