## Synapse

Evidence-backed pipeline integrity analysis and decision support.

Synapse turns inspection data into an auditable integrity workflow: vendor-agnostic ILI ingestion, girth-weld and anomaly alignment, corrosion remaining-strength screening, integrity case execution, compliance evidence, and repair close-out. The system is designed to preserve source-data lineage and make uncertainty visible instead of presenting unverified calculations as engineering truth.

**Repository:** [github.com/dead14/synapse](https://github.com/dead14/synapse)

## How Codex & GPT-5.6 were used

Codex powered by **GPT-5.6** was used as an engineering collaborator throughout the project—not as an autonomous engineering authority. It helped to:

- translate pipeline-integrity requirements into implementation specs, acceptance criteria, and architecture decision records;
- implement and refactor the React/TypeScript frontend, Express APIs, PostgreSQL persistence, and Python alignment engines;
- create regression, contract, and workflow tests for ingestion, alignment, integrity execution, evidence handling, and frontend calculations;
- investigate test and build failures, review cross-layer contracts, and identify edge cases such as missing source rows, invalid physical inputs, tenant isolation, and self-approval;
- improve the interface and developer documentation while keeping the product's engineering-claim boundaries explicit.

All generated changes were reviewed and verified against repository tests and documented product constraints. Codex/GPT-5.6 did not approve integrity assessments, choose operating limits, or replace qualified engineering review. The in-product copilot follows the same advisory-only boundary.

Examples of the resulting engineering record are available in [`docs/specs`](docs/specs), [`docs/decisions`](docs/decisions), and [`docs/verification`](docs/verification).

## What Synapse does

- Imports ILI workbooks with auditable accepted/rejected row dispositions.
- Aligns inspection runs using tie-in, DTW, Hungarian, and manual workflows.
- Preserves stable feature identity and source-row conservation across runs.
- Screens metal-loss features with ASME B31G-2023 context and explicit assumptions.
- Manages integrity cases through Import → Validate → Align → Assess → Decide → Repair → Verify.
- Enforces independent approval and controlled evidence-status transitions.
- Maps Indonesian compliance requirements to reviewed evidence.
- Provides transparent qualitative risk, Direct Assessment, CP, field-package, and integrity-timeline workspaces.

See [`docs/product/integrity-platform-boundaries.md`](docs/product/integrity-platform-boundaries.md) for supported claims and deliberate product limits.

## Technology

| Layer | Stack |
| --- | --- |
| Web application | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| API and realtime | Node.js, Express 5, Socket.IO |
| Engineering engines | Python, NumPy, pandas, SQLAlchemy, openpyxl |
| Persistence | PostgreSQL/PostGIS with additive SQL migrations |
| Testing | Node test runner, Python unittest, Oxlint, TypeScript/Vite production build |

## Quick start

### Prerequisites

- Node.js 24+
- Python 3.11+
- PostgreSQL 15+ (PostGIS is recommended for spatial capabilities)

### Install

```bash
git clone https://github.com/dead14/synapse.git
cd synapse
npm install --prefix frontend
npm install --prefix backend
python -m pip install -r backend/requirements.txt
```

Copy the example configuration and replace all placeholder credentials:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

Create the PostgreSQL database referenced by `DATABASE_URL`. The backend applies the repository's additive schema bootstrap when it starts.

### Run in development

Use two terminals:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

The frontend defaults to [http://localhost:5173](http://localhost:5173), with the API and Socket.IO server at [http://localhost:8000](http://localhost:8000).

For a production-style local start that builds the frontend and serves the application through the backend:

```bash
npm start
```

## Verification

```bash
npm test --prefix backend
npm run check --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

The latest recorded verification results are in [`docs/verification/integrity-roadmap-verification.md`](docs/verification/integrity-roadmap-verification.md).

## Architecture

```text
frontend/                     React application and browser-side engineering workflows
backend/src/modules/          Tenant-scoped API, workflow, and persistence modules
backend/src/python_engines/   Ingestion, tie-in, alignment, and export engines
backend/migrations/           Additive PostgreSQL schema changes
engine/phylogenesis/          Multi-run canonical-anchor analysis
docs/specs/                   Feature contracts and acceptance criteria
docs/decisions/               Architecture decision records
docs/verification/            Reproducible verification evidence
```

The application is a modular monolith: the frontend communicates with an Express API, long-running alignment work reports progress through Socket.IO, Python engines perform data-intensive analysis, and PostgreSQL retains tenant-owned workflow and evidence records.

## Engineering safety boundary

Synapse is decision-support software. A calculated result is not an approval. Qualified engineers remain responsible for validating input data, selecting applicable standards and methods, reviewing assumptions, setting operating limits, and approving integrity actions. Quantitative API 581 and unvalidated advanced-threat calculations are intentionally unavailable until licensed methods, input models, benchmarks, and independent verification are supplied.
