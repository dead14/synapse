import sys
from engine import core
import io

# Ensure stdout is unbuffered and uses UTF-8 so Node.js gets real-time logs without Unicode errors
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', line_buffering=True)

def mock_input(prompt):
    # Print the prompt to stdout so Node.js knows we are asking for something,
    # but normally we just want to feed it directly from stdin.
    line = sys.stdin.readline().strip()
    return line

# Patch the input function inside engine.core
core.input = mock_input

import argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--clockTol', type=float, default=15.0)
    parser.add_argument('--distGwTol', type=float, default=0.2)
    parser.add_argument('--depthGrowthMax', type=float, default=25.0)
    parser.add_argument('--ota', type=float, default=1.5)
    parser.add_argument('--db', action='store_true', help="Use database mode")
    parser.add_argument('--runOldId', type=int)
    parser.add_argument('--runNewId', type=int)
    parser.add_argument('--sessionId', type=int)
    args = parser.parse_args()

    session_id = args.sessionId
    if args.db and not session_id:
        # Create a new session on the fly
        import os
        import sys
        sys.path.append(os.path.dirname(os.path.abspath(__file__)))
        from backend.models import SessionLocal, AlignmentSession, Pipeline
        
        db_session = SessionLocal()
        
        # We need a pipeline ID, let's just pick the first one or create one
        pipeline = db_session.query(Pipeline).first()
        if not pipeline:
            pipeline = Pipeline(name="Default Pipeline")
            db_session.add(pipeline)
            db_session.commit()
            
        new_session = AlignmentSession(
            pipeline_id=pipeline.id,
            run_old_id=args.runOldId,
            run_new_id=args.runNewId,
            params_json={"clockTol": args.clockTol, "distGwTol": args.distGwTol}
        )
        db_session.add(new_session)
        db_session.commit()
        session_id = new_session.id
        db_session.close()

    core.main(
        clockTol=args.clockTol,
        distGwTol=args.distGwTol,
        depthGrowthMax=args.depthGrowthMax,
        ota=args.ota,
        runOldId=args.runOldId,
        runNewId=args.runNewId,
        sessionId=session_id
    )
