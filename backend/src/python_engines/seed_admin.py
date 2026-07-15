import bcrypt
from models import SessionLocal, Organization, User

db = SessionLocal()
try:
    existing = db.query(Organization).filter_by(slug='synapse-hq').first()
    if not existing:
        org = Organization(name='Synapse HQ', slug='synapse-hq', plan='enterprise')
        db.add(org)
        db.flush()
        
        pw_hash = bcrypt.hashpw(b'admin123', bcrypt.gensalt()).decode('utf-8')
        admin = User(
            organization_id=org.id,
            username='Admin',
            email='admin@synapse.com',
            password_hash=pw_hash,
            role='super_admin'
        )
        db.add(admin)
        db.commit()
        print('Super Admin created: admin@synapse.com / admin123')
    else:
        print('Super Admin already exists')
except Exception as e:
    db.rollback()
    print(f'Error: {e}')
finally:
    db.close()
