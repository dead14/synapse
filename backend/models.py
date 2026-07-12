import os
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, JSON, create_engine
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
    name = Column(String, unique=True, index=True)
    organization_id = Column(Integer, ForeignKey('organizations.id'), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    runs = relationship("SurveyRun", back_populates="pipeline")
    sessions = relationship("AlignmentSession", back_populates="pipeline")
    organization = relationship("Organization", back_populates="pipelines")

class SurveyRun(Base):
    __tablename__ = 'survey_runs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(Integer, ForeignKey('pipelines.id'))
    survey_year = Column(Integer, index=True)
    vendor = Column(String)
    source_file = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    row_count = Column(Integer, default=0)

    # Relationships
    pipeline = relationship("Pipeline", back_populates="runs")
    features = relationship("ILIFeature", back_populates="run", cascade="all, delete-orphan")

class ILIFeature(Base):
    __tablename__ = 'ili_features'

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey('survey_runs.id'), index=True)
    
    # Core universal fields
    feature_id = Column(String)
    log_distance_m = Column(Float, index=True)
    joint_number = Column(Integer)
    dist_to_us_gw_m = Column(Float)
    joint_length_m = Column(Float)
    feature_type = Column(String, index=True)
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

class AlignmentSession(Base):
    __tablename__ = 'alignment_sessions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(Integer, ForeignKey('pipelines.id'))
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
engine = create_engine('postgresql://postgres:123456789@localhost:5432/synapse', echo=False)

def init_db():
    Base.metadata.create_all(engine)

SessionLocal = sessionmaker(bind=engine)
