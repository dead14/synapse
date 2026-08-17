import { FiActivity, FiShield, FiX } from 'react-icons/fi';

import Modal from '../common/Modal';
import { MathInline, MathBlock } from '../ds';
import { ALIGNMENT_TEX } from '../../lib/alignment/notation';
import { MATCH_METHOD_LABELS } from '../../utils/alignmentDisplay';

/**
 * Why one pair was accepted, in the terms the matcher that accepted it actually
 * used.
 *
 * The two matchers are shown by two different renderers on purpose. A
 * tolerance-gated pair has a cost: a weighted sum of penalties, each measured
 * against the gate an engineer set. A probabilistic pair has a posterior: a
 * likelihood ratio per channel against a coincidence model, combined and then
 * normalised over every rival the pair had to beat. Presenting them in one
 * shared layout would invite reading a cost of 0.8 as "a good score" and a
 * posterior of 0.8 as the same thing, and they are not comparable quantities.
 */

type Channel = {
  name: string;
  unit: string;
  observed: number;
  /** Tolerance-gated rows. */
  tolerance?: number;
  weight?: number | null;
  penalty?: number;
  /** True when the channel admits or rejects a pair without costing it anything. */
  gateOnly?: boolean;
  /** Probabilistic rows. */
  spread?: number;
  /** Spread of this quantity under the coincidence hypothesis, same unit. */
  nullSpread?: number;
  /** False when the section cannot discriminate on this channel at all. */
  informative?: boolean;
  logLikelihoodRatio?: number;
};

/**
 * The wording for each channel lives here rather than in the payload.
 *
 * The engine attaches its evidence to every matched row and stores it with the
 * row, so a sentence written engine-side is a sentence repeated once per pair —
 * tens of thousands of times on a real comparison. The payload carries numbers;
 * this turns them back into an explanation.
 */
const COST_CHANNEL_NOTES: Record<string, string> = {
  Odometer: 'Gate only — the odometer window admits or rejects a pair but adds nothing to its cost.',
};

/**
 * The penalty caption under every non-gate channel.
 *
 * Kept as a plain string as well as TeX: the caption is also the accessible
 * label for the typeset version, and a screen reader announcing
 * `c sub k equals w sub k` is less use than the words.
 */
const COST_CHANNEL_FORMULA = 'weight × (absolute difference ÷ tolerance)';

function bayesianChannelNote(channel: Channel): string {
  const spread = Number(channel.nullSpread);
  const coincidence = Number.isFinite(spread)
    ? `${spread.toFixed(spread < 10 ? 2 : 0)} ${channel.unit}`
    : '—';
  if (channel.informative === false) {
    // Said plainly, because a row of zeroes with no explanation reads like a
    // bug. The channel is measured more coarsely than this section varies, so
    // agreement on it genuinely carries no information either way.
    return `No evidence either way: the tool measures this to ±${decimals(channel.spread, 0)} ${channel.unit}, but everything in this section falls within ${coincidence}.`;
  }
  switch (channel.name) {
    case 'Position':
      return `Residual after the section's own displacement. Two unrelated defects could differ by anything across ${coincidence}.`;
    case 'U/S weld distance':
      return `Agreement on where the defect sits inside its own joint. A joint here is ${coincidence} long.`;
    case 'Clock':
      return 'Circumferential agreement. Two unrelated defects differ by anything up to 180°.';
    case 'Length':
      return `Growth is expected, shrinkage is not — so the two are weighed differently. Lengths in this section span ${coincidence}.`;
    case 'Width':
      return `Widths in this section span ${coincidence}.`;
    default:
      return '';
  }
}

export type MatchEvidence = {
  method?: string;
  objective?: string;
  solverCost?: number;
  breakdownTotal?: number;
  note?: string;
  channels?: Channel[];
  logBayesFactor?: number;
  posterior?: number;
  oldSidePosterior?: number;
  newSidePosterior?: number;
  rivals?: { old?: number; new?: number };
  residualM?: number;
  segment?: number;
  drift?: {
    shiftM?: number;
    scale?: number;
    scaleApplied?: boolean;
    sigmaM?: number;
    support?: number;
    voteCandidates?: number;
    bandwidthM?: number;
  };
  prior?: { matchProbability?: number; logOdds?: number };
  acceptThresholdLogBayesFactor?: number;
  sectionPValue?: number | null;
  sectionPermutationTrials?: number;
};

/**
 * Tailwind's `border-*` utilities carry no colour of their own here, and the
 * grey literals this drawer used to hardcode turned invisible the moment the app
 * was switched to the dark theme. The rules are drawn from the design tokens
 * instead, inline so they cannot lose a cascade fight with a utility class.
 */
const HAIRLINE = { borderColor: 'var(--ds-line)' } as const;
const HAIRLINE_STRONG = { borderColor: 'var(--ds-line-strong)' } as const;

function decimals(value: unknown, places = 3): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(places) : '—';
}

/** Odds are what an engineer can weigh; nats are what the model computes in. */
function oddsFromLog(logRatio: number): string {
  if (!Number.isFinite(logRatio)) return '—';
  const odds = Math.exp(logRatio);
  if (odds >= 1000) return `${Math.round(odds).toLocaleString()}:1 for`;
  if (odds >= 1) return `${odds.toFixed(1)}:1 for`;
  if (odds <= 0) return '—';
  return `${(1 / odds).toFixed(1)}:1 against`;
}

function CostEvidence({ evidence }: { evidence: MatchEvidence }) {
  const channels = evidence.channels ?? [];
  return (
    <div className="ds-stack">
      <p className="text-sm ds-muted">
        This pair was chosen by the tolerance-gated matcher. Every channel below had to fall inside
        its gate for the pair to be admitted at all; the penalties then decide which admissible set
        of pairs is cheapest overall. A lower cost is a better fit — it is not a probability.
      </p>
      {/* The two relations the table's five columns are an instance of. The
          division by the tolerance is what lets a metre, a millimetre and a
          degree be added together in the total at the foot of the table. */}
      <MathBlock tex={ALIGNMENT_TEX.costGate} label="every channel must fall inside its gate" />
      <MathBlock tex={ALIGNMENT_TEX.costTotal} label="total cost is the weighted sum of normalised differences" />
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="border-b" style={HAIRLINE_STRONG}>
            <th className="py-1.5 pr-2 font-semibold">Channel</th>
            <th className="py-1.5 pr-2 font-semibold">Observed</th>
            <th className="py-1.5 pr-2 font-semibold">Gate</th>
            <th className="py-1.5 pr-2 font-semibold">Weight</th>
            <th className="py-1.5 font-semibold">Penalty</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <tr key={channel.name} className="border-b align-top" style={HAIRLINE}>
              <td className="py-1.5 pr-2">
                <strong>{channel.name}</strong>
                <p className="text-[10px] ds-muted">
                  {COST_CHANNEL_NOTES[channel.name]
                    ?? (channel.gateOnly ? '' : (
                      <MathInline
                        tex={ALIGNMENT_TEX.costChannel}
                        label={COST_CHANNEL_FORMULA}
                        scale="sm"
                      />
                    ))}
                </p>
              </td>
              <td className="py-1.5 pr-2">{decimals(channel.observed)} {channel.unit}</td>
              <td className="py-1.5 pr-2">
                {channel.tolerance === undefined ? '—' : `${decimals(channel.tolerance)} ${channel.unit}`}
              </td>
              <td className="py-1.5 pr-2">{channel.weight == null ? '—' : decimals(channel.weight, 2)}</td>
              <td className="py-1.5">{channel.penalty === undefined ? '—' : decimals(channel.penalty, 4)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 pr-2 font-bold" colSpan={4}>Total cost (solver)</td>
            <td className="py-2 font-bold">{decimals(evidence.solverCost, 4)}</td>
          </tr>
        </tfoot>
      </table>
      {evidence.note && (
        <p className="text-xs" style={{ color: 'var(--syn-warning)' }}>{evidence.note}</p>
      )}
      <p className="text-[11px] ds-muted">
        Objective: {evidence.objective ?? '—'}. Depth is deliberately excluded from pair selection
        and evaluated afterwards as a physics check.
      </p>
    </div>
  );
}

function BayesianEvidence({ evidence }: { evidence: MatchEvidence }) {
  const channels = evidence.channels ?? [];
  const drift = evidence.drift ?? {};
  const channelTotal = channels.reduce(
    (total, channel) => total + (Number(channel.logLikelihoodRatio) || 0), 0,
  );
  const priorLogOdds = Number(evidence.prior?.logOdds) || 0;
  const posterior = Number(evidence.posterior);

  return (
    <div className="ds-stack">
      <p className="text-sm ds-muted">
        This pair was chosen by evidence, not by a window. Each channel reports how much more likely
        its reading is if these are the same defect than if they are two unrelated defects that
        happen to lie near each other. The contributions add up, and the total is then weighed
        against every rival candidate on both sides.
      </p>

      <div className="rounded border p-3 text-xs" style={HAIRLINE}>
        <strong className="block mb-1">Step 1 — the displacement this section actually has</strong>
        <p className="ds-muted">
          Every OLD defect proposed a displacement to every NEW defect
          ({(drift.voteCandidates ?? 0).toLocaleString()} proposals). The densest agreement was
          at <strong>{decimals(drift.shiftM)} m</strong>
          {drift.scaleApplied ? <> with a scale of <strong>{decimals(drift.scale, 5)}</strong></> : null},
          supported by <strong>{drift.support ?? 0}</strong> defect(s). The spread of those
          supporting residuals gives the noise scale used below:{' '}
          <MathInline tex="\sigma" label="sigma" /> = <strong>{decimals(drift.sigmaM)} m</strong>
          {' '}— measured from this run, not set by hand.
        </p>
        <MathBlock tex={ALIGNMENT_TEX.drift} label="the section displacement" />
        <MathBlock tex={ALIGNMENT_TEX.sigma} label="sigma is the spread of the supporting residuals" />
      </div>

      <div>
        <strong className="block mb-1 text-xs">Step 2 — evidence, channel by channel</strong>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b" style={HAIRLINE_STRONG}>
              <th className="py-1.5 pr-2 font-semibold">Channel</th>
              <th className="py-1.5 pr-2 font-semibold">Observed</th>
              <th className="py-1.5 pr-2 font-semibold">
                Spread <MathInline tex="\sigma" label="sigma" scale="sm" />
              </th>
              <th className="py-1.5 pr-2 font-semibold">
                <MathInline tex="\log \mathrm{LR}" label="log likelihood ratio" scale="sm" />
              </th>
              <th className="py-1.5 font-semibold">Odds</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr
                key={channel.name}
                className={`border-b align-top${channel.informative === false ? ' opacity-60' : ''}`}
                style={HAIRLINE}
              >
                <td className="py-1.5 pr-2">
                  <strong>{channel.name}</strong>
                  <p className="text-[10px] ds-muted">{bayesianChannelNote(channel)}</p>
                </td>
                <td className="py-1.5 pr-2">{decimals(channel.observed)} {channel.unit}</td>
                <td className="py-1.5 pr-2">{decimals(channel.spread)} {channel.unit}</td>
                <td className="py-1.5 pr-2">{decimals(channel.logLikelihoodRatio, 2)}</td>
                <td className="py-1.5">
                  {channel.informative === false
                    ? 'no evidence'
                    : oddsFromLog(Number(channel.logLikelihoodRatio))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t" style={HAIRLINE_STRONG}>
              <td className="py-1.5 pr-2" colSpan={3}>Channels combined</td>
              <td className="py-1.5 pr-2">{decimals(channelTotal, 2)}</td>
              <td className="py-1.5">{oddsFromLog(channelTotal)}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-2" colSpan={3}>
                Prior log-odds (p = {decimals(evidence.prior?.matchProbability, 2)})
              </td>
              <td className="py-1.5 pr-2">{decimals(priorLogOdds, 2)}</td>
              <td className="py-1.5">—</td>
            </tr>
            <tr>
              <td className="py-2 pr-2 font-bold" colSpan={3}>Total log Bayes factor</td>
              <td className="py-2 font-bold">{decimals(evidence.logBayesFactor, 2)}</td>
              <td className="py-2 font-bold">{oddsFromLog(Number(evidence.logBayesFactor))}</td>
            </tr>
          </tfoot>
        </table>
        {/* Four quantities in one table — a per-channel ratio, a prior in
            log-odds, their sum, and a threshold on it — related by two
            equations that used to appear nowhere on this screen. */}
        <MathBlock tex={ALIGNMENT_TEX.logLikelihoodRatio} label="one channel's log likelihood ratio" scale="sm" />
        <MathBlock tex={ALIGNMENT_TEX.logBayesFactor} label="the total log Bayes factor" scale="sm" />
        <MathBlock tex={ALIGNMENT_TEX.acceptance} label="acceptance threshold" scale="sm" />
        <p className="text-[11px] ds-muted mt-1">
          Accepted because the total exceeds
          {' '}{decimals(evidence.acceptThresholdLogBayesFactor, 2)} — that is, because "same defect"
          explains the evidence better than coincidence does. Depth is excluded: it is the growth
          measurement this alignment exists to produce, so using it to choose pairs would make the
          answer circular.
        </p>
      </div>

      <div className="rounded border p-3 text-xs" style={HAIRLINE}>
        <strong className="block mb-1">Step 3 — against the competition</strong>
        <p className="ds-muted">
          The OLD defect had <strong>{evidence.rivals?.old ?? 0}</strong> rival partner(s) and the
          NEW defect had <strong>{evidence.rivals?.new ?? 0}</strong>. Normalising against them —
          and against the standing option that there is no match at all — gives
          {' '}{(Number(evidence.oldSidePosterior) * 100).toFixed(2)}% from the OLD side and
          {' '}{(Number(evidence.newSidePosterior) * 100).toFixed(2)}% from the NEW side. The
          reported confidence is the lower of the two: a pair counts as confident only when it is
          the best explanation of <em>both</em> defects.
        </p>
        <MathBlock tex={ALIGNMENT_TEX.sidePosterior} label="one side normalised against its rivals" scale="sm" />
        <MathBlock tex={ALIGNMENT_TEX.posterior} label="confidence is the lower of the two sides" scale="sm" />
        <p className="mt-2 text-base font-bold">
          Match confidence: {Number.isFinite(posterior) ? `${(posterior * 100).toFixed(2)}%` : '—'}
        </p>
      </div>

      {evidence.sectionPermutationTrials ? (
        <div className="rounded border p-3 text-xs" style={HAIRLINE}>
          <strong className="block mb-1">Step 4 — Monte-Carlo calibration of the section</strong>
          <p className="ds-muted">
            The section was re-matched against {evidence.sectionPermutationTrials} synthetic runs of
            the same defect count and the same attribute distributions, with the association between
            them destroyed. Fraction that produced evidence at least this strong:
            {' '}<strong>{evidence.sectionPValue == null ? '—' : evidence.sectionPValue.toFixed(4)}</strong>.
            A small value means this much agreement is not something defect density alone produces.
          </p>
        </div>
      ) : (
        <p className="text-[11px] ds-muted">
          Monte-Carlo calibration did not run for this section (disabled, or the section exceeds the
          permutation budget).
        </p>
      )}
    </div>
  );
}

export default function MatchEvidenceDrawer({
  evidence,
  title,
  onClose,
}: {
  evidence: MatchEvidence;
  title: string;
  onClose: () => void;
}) {
  const method = evidence.method ?? '';
  const isBayesian = method === 'BAYESIAN_DRIFT';

  return (
    <Modal onClose={onClose} ariaLabel="Match evidence" panelClassName="ds-dialog max-w-3xl">
      <div className="p-5 ds-stack">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="ds-muted text-[11px] uppercase tracking-wider flex items-center gap-1">
              {isBayesian ? <FiActivity aria-hidden="true" /> : <FiShield aria-hidden="true" />}
              {MATCH_METHOD_LABELS[method] ?? method ?? 'Match evidence'}
              {evidence.segment !== undefined && <> · segment {evidence.segment}</>}
            </p>
            <h2 className="text-base font-bold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close match evidence"
            className="ds-btn ds-btn--sm ds-btn--ghost ds-btn--icon"
          >
            <FiX aria-hidden="true" />
          </button>
        </div>

        {isBayesian ? <BayesianEvidence evidence={evidence} /> : <CostEvidence evidence={evidence} />}
      </div>
    </Modal>
  );
}
