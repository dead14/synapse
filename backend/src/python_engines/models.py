import os
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, JSON, UniqueConstraint, create_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime

Base = declarative_base()

class Organization(Base):
    __tablename__ = 'organizations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True)
    plan = Column(String, default='free')
    created_at = Column(DateTime, default=datetime.utcnow)
    # Relationships
    users = relationship("User", back_populates="organization")
    pipelines = relationship("Pipeline", back_populates="organization")

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(Integer, ForeignKey('organizations.id'), index=True)
    username = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default='engineer')  # super_admin, admin, engineer, viewer
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Relationships
    organization = relationship("Organization", back_populates="users")
    activity_logs = relationship("ActivityLog", back_populates="user", cascade="all, delete-orphan")

class ActivityLog(Base):
    __tablename__ = 'activity_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True, nullable=True)
    organization_id = Column(Integer, ForeignKey('organizations.id'), index=True, nullable=True)
    action = Column(String, nullable=False)
    target = Column(String)
    ip_address = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="activity_logs")

class Pipeline(Base):
    __tablename__ = 'pipelines'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, index=True)
    organization_id = Column(Integer, ForeignKey('organizations.id'), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    runs = relationship("SurveyRun", back_populates="pipeline")
    sessions = relationship("AlignmentSession", back_populates="pipeline")
    organization = relationship("Organization", back_populates="pipelines")
    canonical_anchors = relationship("CanonicalAnchor", back_populates="pipeline")

class CanonicalAnchor(Base):
    __tablename__ = 'canonical_anchors'

    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(Integer, ForeignKey('pipelines.id'), index=True, nullable=False)
    abs_chainage = Column(Float, nullable=False, index=True)
    sigma = Column(Float, nullable=False, default=0.5)
    confidence = Column(Float, nullable=False, default=0.5)
    is_golden = Column(Boolean, nullable=False, default=False, index=True)
    anchor_type = Column(String(20), nullable=False, default='GW')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    pipeline = relationship("Pipeline", back_populates="canonical_anchors")
    alignment_links = relationship("AlignmentLink", back_populates="canonical_anchor", cascade="all, delete-orphan")

class AlignmentLink(Base):
    __tablename__ = 'alignment_links'

    id = Column(Integer, primary_key=True, autoincrement=True)
    canonical_id = Column(Integer, ForeignKey('canonical_anchors.id'), index=True, nullable=False)
    ili_run_id = Column(Integer, ForeignKey('survey_runs.id'), index=True, nullable=False)
    odometer = Column(Float, nullable=False)
    confidence = Column(Float, nullable=False, default=0.5)
    source_job_id = Column(Integer, ForeignKey('alignment_sessions.id'), index=True)
    is_outlier = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    canonical_anchor = relationship("CanonicalAnchor", back_populates="alignment_links")
    ili_run = relationship("SurveyRun", back_populates="alignment_links")
    source_job = relationship("AlignmentSession", foreign_keys=[source_job_id])

class SurveyRun(Base):
    __tablename__ = 'survey_runs'
    __table_args__ = (
        UniqueConstraint('pipeline_id', 'source_sha256', name='uq_survey_runs_pipeline_source_sha256'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(Integer, ForeignKey('pipelines.id'))
    survey_year = Column(Integer, index=True)
    vendor = Column(String)
    source_file = Column(String)
    source_object_key = Column(String)
    source_sha256 = Column(String(64))
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)
    row_count = Column(Integer, default=0)
    parser_version = Column(String(64))
    schema_version = Column(String(64))
    ingestion_audit = Column(JSON, default=dict)

    # Relationships
    pipeline = relationship("Pipeline", back_populates="runs")
    features = relationship("ILIFeature", back_populates="run", cascade="all, delete-orphan")
    alignment_links = relationship("AlignmentLink", back_populates="ili_run", cascade="all, delete-orphan")

class ILIFeature(Base):
    __tablename__ = 'ili_features'

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey('survey_runs.id'), index=True)
    
    # Core universal fields.  Neither log_distance_m nor feature_type carries a
    # standalone index: every read path filters run_id first, so the composite
    # ix_ili_features_run_distance and the partial anchor index serve them.  A
    # global index on either only ever cost write throughput on the ingest COPY.
    feature_id = Column(String)
    log_distance_m = Column(Float)
    joint_number = Column(Integer)
    dist_to_us_gw_m = Column(Float)
    # Computed by the U/S GW distance generator, never by a vendor.  Held apart
    # from the column above because they are different measurements: a vendor
    # measures to the weld centreline, this measures to the odometer the weld
    # feature was reported at.  Keeping both means a reviewer can always tell a
    # surveyed number from a derived one, and the original survives a re-run.
    dist_to_us_gw_derived_m = Column(Float)
    #: Odometer of the girth weld the derived value was measured from.
    us_gw_reference_m = Column(Float)
    joint_length_m = Column(Float)
    feature_type = Column(String)
    feature_identification = Column(String)
    dim_classification = Column(String)
    clock_position = Column(String)
    wall_thickness_mm = Column(Float)
    length_mm = Column(Float)
    width_mm = Column(Float)
    depth_pct = Column(Float)
    surface_location = Column(String)
    erf_asme = Column(Float)
    psafe_bar = Column(Float)
    comment = Column(String)

    # Relationships
    run = relationship("SurveyRun", back_populates="features")


class RunGwDistanceGeneration(Base):
    """What the U/S GW distance generator did to one run, and when.

    One row per run: re-running replaces it, because only the current state of
    ``ILIFeature.dist_to_us_gw_derived_m`` is meaningful and a history of
    superseded passes would only invite reading a stale one.
    """

    __tablename__ = 'run_gw_distance_generation'

    run_id = Column(Integer, ForeignKey('survey_runs.id'), primary_key=True)
    generated_at = Column(DateTime, default=datetime.utcnow)
    girth_welds = Column(Integer, nullable=False)
    derived_count = Column(Integer, nullable=False)
    no_upstream_weld_count = Column(Integer, nullable=False)
    unreadable_distance_count = Column(Integer, nullable=False)
    vendor_reported_count = Column(Integer, nullable=False)
    feature_count = Column(Integer, nullable=False)
    median_joint_length_m = Column(Float)
    generated_by = Column(Integer, ForeignKey('users.id'))

class AlignmentSession(Base):
    __tablename__ = 'alignment_sessions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(Integer, ForeignKey('pipelines.id'))
    organization_id = Column(Integer, ForeignKey('organizations.id'), index=True, nullable=True)
    created_by = Column(Integer, ForeignKey('users.id'), index=True, nullable=True)
    run_old_id = Column(Integer, ForeignKey('survey_runs.id'))
    run_new_id = Column(Integer, ForeignKey('survey_runs.id'))
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String, default="running") # running, completed, failed
    params_json = Column(JSON)

    # Relationships
    pipeline = relationship("Pipeline", back_populates="sessions")
    results = relationship("AlignmentResult", back_populates="session", cascade="all, delete-orphan")
    
class AlignmentResult(Base):
    __tablename__ = 'alignment_results'

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey('alignment_sessions.id'), index=True)
    feature_new_id = Column(Integer, ForeignKey('ili_features.id'), nullable=True)
    feature_old_id = Column(Integer, ForeignKey('ili_features.id'), nullable=True)
    
    match_status = Column(String) # Matched, Only NEW, Only OLD
    odo_diff = Column(Float)
    gw_diff = Column(Float)
    clock_changed = Column(Boolean)
    clock_diff_deg = Column(Float)
    depth_diff = Column(Float)
    length_diff = Column(Float)
    width_diff = Column(Float)
    surf_changed = Column(Boolean)
    growth_flag = Column(String)
    clock_integrity = Column(String)

    # Relationships
    session = relationship("AlignmentSession", back_populates="results")
    feature_new = relationship("ILIFeature", foreign_keys=[feature_new_id])
    feature_old = relationship("ILIFeature", foreign_keys=[feature_old_id])

# Database Setup
class FieldSynonymDictionary(Base):
    """
    Stores known column synonyms from different vendors to auto-detect mappings.
    e.g. universal_column='log_distance_m', known_synonym='Absolute Distance, m'
    """
    __tablename__ = 'field_synonym_dictionary'

    id = Column(Integer, primary_key=True, autoincrement=True)
    universal_column = Column(String, index=True, nullable=False)
    known_synonym = Column(String, index=True, nullable=False)


class FeatureTypeSynonym(Base):
    """
    Stores known feature type synonyms/acronyms to auto-detect feature types.
    e.g. standard_name='Metal Loss', known_synonym='cocl'
    """
    __tablename__ = 'feature_type_synonym'

    id = Column(Integer, primary_key=True, autoincrement=True)
    standard_name = Column(String, index=True, nullable=False)
    known_synonym = Column(String, index=True, nullable=False)

# Database Setup
DATABASE_URL = os.getenv('DATABASE_URL')
engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True) if DATABASE_URL else None

def require_engine():
    if engine is None:
        raise RuntimeError('DATABASE_URL must be configured before using the database engine')
    return engine

def init_db():
    Base.metadata.create_all(require_engine())

if engine is not None:
    SessionLocal = sessionmaker(bind=engine)
else:
    def SessionLocal(*args, **kwargs):
        raise RuntimeError('DATABASE_URL must be configured before opening a database session')
