from sqlalchemy import Column, Integer, String, Float, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

class ILIFeature(Base):
    __tablename__ = 'ili_features'

    id = Column(Integer, primary_key=True, autoincrement=True)
    survey_year = Column(Integer, index=True) # e.g. 2020, 2025
    feature_id = Column(String)
    abs_distance_m = Column(Float, index=True)
    joint_number = Column(String)
    dist_to_us_gw_m = Column(Float)
    joint_length_m = Column(Float)
    feature_type = Column(String, index=True)
    feature_identification = Column(String)
    dimension_classification = Column(String)
    orientation = Column(String)
    wt_mm = Column(Float)
    length_mm = Column(Float)
    width_mm = Column(Float)
    depth_pct = Column(Float)
    location = Column(String)
    erf_b31g = Column(Float)
    psafe_b31g_bar = Column(Float)
    comments = Column(String)

class ILIAlignmentResult(Base):
    __tablename__ = 'ili_alignment_results'

    id = Column(Integer, primary_key=True, autoincrement=True)
    run1_feature_id = Column(Integer) # references ILIFeature.id
    run2_feature_id = Column(Integer) # references ILIFeature.id
    match_status = Column(String) # 'Matched', 'New in Run 2', 'Missing in Run 2'
    growth_depth_pct = Column(Float) # run2.depth_pct - run1.depth_pct
    growth_length_mm = Column(Float)
    growth_width_mm = Column(Float)

# Database Setup
engine = create_engine('postgresql://postgres:password@localhost:5432/synapse', echo=False)

def init_db():
    Base.metadata.create_all(engine)

SessionLocal = sessionmaker(bind=engine)
