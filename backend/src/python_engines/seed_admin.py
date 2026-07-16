import os
import bcrypt
from models import SessionLocal, Organization, User

def required_env(name):
    value = os.getenv(name, '').strip()
    if not value:
        raise RuntimeError(f'{name} must be configured')
    return value

def seed_admin():
    org_name = required_env('SYNAPSE_ADMIN_ORG_NAME')
    org_slug = required_env('SYNAPSE_ADMIN_ORG_SLUG')
    username = required_env('SYNAPSE_ADMIN_USERNAME')
    email = required_env('SYNAPSE_ADMIN_EMAIL').lower()
    password = required_env('SYNAPSE_ADMIN_PASSWORD')
    if len(password) < 6 or len(password) > 128:
        raise RuntimeError('SYNAPSE_ADMIN_PASSWORD must be between 6 and 128 characters')

    db = SessionLocal()
    try:
        existing_user = db.query(User).filter_by(email=email).first()
        if existing_user:
            print('Super Admin already exists')
            return

        org = db.query(Organization).filter_by(slug=org_slug).first()
        if not org:
            org = Organization(name=org_name, slug=org_slug, plan='enterprise')
            db.add(org)
            db.flush()

        pw_hash = bcrypt.hashpw(
            password.encode('utf-8'),
            bcrypt.gensalt(rounds=12),
        ).decode('utf-8')
        admin = User(
            organization_id=org.id,
            username=username,
            email=email,
            password_hash=pw_hash,
            role='super_admin'
        )
        db.add(admin)
        db.commit()
        print(f'Super Admin created: {email}')
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == '__main__':
    seed_admin()
