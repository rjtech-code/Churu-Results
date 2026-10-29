import { useState } from 'react';
import { api } from '../../api/api';
import { messageFor } from '../../api/errors';
import { OFFICIAL_COUNTS, SAMPLE_HREF, fmt } from '../../api/superadminTypes';
import type {
  GeographyCounts,
  MasterCheck,
  MasterDataDeletes,
  MasterRun,
  Overview,
} from '../../api/superadminTypes';
import { StepBar } from '../../components/AdminParts';
import { ActionButton, ConfirmDialog, DropZone, Impact, Problems, TaskCard } from './parts';
import type { ImpactRow, PickedJson, PickedXlsx } from './parts';

const STEPS = ['Files चुनें', 'जाँच (dry-run)', 'पक्का करें'] as const;
const KEEPS = 'Users (logins), settings, Panchayat Samitis के Hindi names और audit log।';
const COUNT_LABELS: readonly [keyof GeographyCounts, string][] = [
  ['panchayatSamitis', 'Panchayat Samitis'],
  ['psWards', 'PS wards'],
  ['zpWards', 'ZP wards'],
  ['booths', 'Booths'],
];

function rows(d: MasterDataDeletes): ImpactRow[] {
  return [
    ['booths', d.booths],
    ['PS wards', d.psWards],
    ['ZP wards', d.zpWards],
    ['parties', d.parties],
    ['उम्मीदवार', d.candidates],
    ['booth / postal entries', d.entries],
    ['declared wards', d.declaredWards],
  ];
}

function CountCards({ counts, voters }: { counts: GeographyCounts; voters: number | null }) {
  return (
    <ul className="sa-check-cards">
      {COUNT_LABELS.map(([key, label]) => {
        const ok = counts[key] === OFFICIAL_COUNTS[key];
        return (
          <li key={key} className={`sa-check-card ${ok ? 'sa-ok' : 'sa-warn'}`}>
            <span className="sa-count-n">{fmt(counts[key])}</span>
            <span className="sa-count-l">{label}</span>
            <span className="sa-check-mark">{ok ? '✓ सही' : `! official ${fmt(OFFICIAL_COUNTS[key])}`}</span>
          </li>
        );
      })}
      <li className="sa-check-card">
        <span className="sa-count-n">{voters === null ? '—' : fmt(voters)}</span>
        <span className="sa-count-l">कुल voters</span>
      </li>
    </ul>
  );
}

/** "मास्टर डेटा बदलें": rare; a 3-step wizard with a dry run before anything changes. */
export function MasterDataCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [geography, setGeography] = useState<PickedXlsx | null>(null);
  const [voters, setVoters] = useState<PickedXlsx | null>(null);
  const [psNames, setPsNames] = useState<PickedJson | null>(null);
  const [fixes, setFixes] = useState<PickedJson | null>(null);
  const [noFixes, setNoFixes] = useState(false);
  const [check, setCheck] = useState<MasterCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const task = ov.masterData;
  const defaults = task.defaults;

  const changed =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setCheck(null);
      setCheckError(null);
    };
  const body = () => ({
    geography,
    voters,
    ...(psNames ? { psNames } : {}),
    ...(fixes ? { fixes } : {}),
    ...(noFixes && !fixes ? { noFixes: true } : {}),
  });
  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(await api<MasterCheck>('POST', '/api/superadmin/master-data/check', body()));
    } catch (err) {
      setCheckError(messageFor(err));
    } finally {
      setChecking(false);
    }
  };
  const step = check?.ok === true ? 2 : check !== null ? 1 : 0;
  // The dry run changes nothing, so it works even while the Counting Lock is ON.
  const filesReason = !geography || !voters ? 'पहले दोनों Excel files चुनें' : null;

  return (
    <TaskCard
      title="मास्टर डेटा बदलें (Master data)"
      icon="🗂️"
      danger
      testId="card-master-data"
      intro={
        <p>
          कभी-कभार ही: नई Geography और Voters Excel से सारे booths, wards और voters दोबारा भरें। इससे{' '}
          <strong>सारा election data</strong> (parties, उम्मीदवार, entries) भी हटेगा।
        </p>
      }
    >
      <StepBar steps={STEPS} current={step} />
      <div className="sa-drop-grid">
        <DropZone
          kind="xlsx"
          label="1. Geography Excel (polling stations)"
          hint=".xlsx, 5 MB तक"
          sampleHref={SAMPLE_HREF.geography}
          value={geography}
          onChange={changed(setGeography)}
        />
        <DropZone
          kind="xlsx"
          label="2. Voters Excel"
          hint=".xlsx, 5 MB तक — polling-station file भी चलेगी"
          sampleHref={SAMPLE_HREF.voters}
          value={voters}
          onChange={changed(setVoters)}
        />
      </div>
      <details className="sa-advanced">
        <summary>उन्नत (Advanced): Hindi names और fixes</summary>
        <p className="sa-hint">
          अपने-आप system में मौजूद Hindi names ({defaults.hindiNames} PS) और{' '}
          {defaults.fixes
            ? `पिछली बार की fixes file (${String(defaults.fixes.entries)} fixes)`
            : 'कोई fix नहीं (पहले कोई fixes file नहीं डाली गई)'}{' '}
          use होंगे। बदलना हो तभी नई file डालें।
        </p>
        <div className="sa-drop-grid">
          <DropZone
            kind="json"
            label="PS Hindi names (JSON)"
            hint="खाली छोड़ें = system के names"
            sampleHref={SAMPLE_HREF.psNames}
            value={psNames}
            onChange={changed(setPsNames)}
          />
          <DropZone
            kind="json"
            label="Approved fixes (JSON)"
            hint="खाली छोड़ें = पिछली fixes file"
            sampleHref={SAMPLE_HREF.fixes}
            value={fixes}
            onChange={changed(setFixes)}
          />
        </div>
        {defaults.fixes && !fixes && (
          <label className="sa-check">
            <input
              type="checkbox"
              checked={noFixes}
              onChange={(e) => {
                changed(setNoFixes)(e.target.checked);
              }}
            />{' '}
            इस बार कोई fix न लगाएँ
          </label>
        )}
      </details>

      <div className="sa-row-actions">
        <ActionButton
          label={checking ? 'जाँच हो रही है…' : 'जाँच करें (dry-run)'}
          kind="secondary"
          reason={checking ? 'जाँच चल रही है…' : filesReason}
          onClick={() => void runCheck()}
        />
      </div>
      {checkError && (
        <p className="msg msg-error" role="alert">
          ✗ {checkError}
        </p>
      )}
      {check && (
        <div className="sa-check-result" data-testid="sa-check-result">
          {check.counts && <CountCards counts={check.counts} voters={check.totalVoters} />}
          {check.ok ? (
            <p className="msg msg-ok">✓ Files सही हैं। Database में अभी कुछ नहीं बदला।</p>
          ) : (
            <div className="msg msg-error" role="alert">
              ✗ Files में {check.problems.length} गलतियाँ हैं — Excel ठीक करके फिर से जाँचें:
              <ul className="sa-problem-list">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {check.warnings.length > 0 && (
            <details className="sa-warnings">
              <summary>ध्यान दें ({check.warnings.length})</summary>
              <ul>
                {check.warnings.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {check?.ok === true && (
        <>
          <Impact deletes={rows(task.deletes)} keeps={KEEPS} />
          <ActionButton
            label="मास्टर डेटा बदलें"
            kind="danger"
            reason={task.reason}
            onClick={() => {
              setOpen(true);
            }}
          />
        </>
      )}
      {open && (
        <ConfirmDialog
          title="मास्टर डेटा बदलें"
          danger
          summary={
            <>
              <Impact deletes={rows(task.deletes)} keeps={KEEPS} />
              <p className="sa-hint">पहले अपने-आप backup बनेगा। फिर नई files से data भरेगा।</p>
            </>
          }
          word="RESET"
          askPassword={ov.confirmedUntil === null}
          confirmLabel="मास्टर डेटा बदलें"
          workingText="Data बदल रहा है (1-2 मिनट लग सकते हैं)… कृपया page बंद न करें"
          run={async (password) => {
            const r = await api<MasterRun>('POST', '/api/superadmin/master-data/run', {
              ...body(),
              confirmText: 'RESET',
              ...(password ? { password } : {}),
            });
            if (r.status !== 'DONE') {
              const lines =
                r.status === 'IMPORT_FAILED'
                  ? [
                      'पुराना data हट गया पर नया data नहीं भरा — files ठीक करके फिर से चलाएँ। पुराना data backup में है।',
                      ...r.problems,
                      ...(r.backupFile ? [`Backup file: ${r.backupFile}`] : []),
                    ]
                  : r.problems;
              throw new Problems(lines);
            }
            setCheck(null);
            setGeography(null);
            setVoters(null);
            setPsNames(null);
            setFixes(null);
            return {
              title: 'मास्टर डेटा बदल गया',
              lines: [
                ...(r.counts ? COUNT_LABELS.map(([k, label]) => `${label}: ${fmt(r.counts?.[k] ?? 0)}`) : []),
                ...(r.totalVoters == null ? [] : [`कुल voters: ${fmt(r.totalVoters)}`]),
                'अब DM: parties import → RO accounts → उम्मीदवार list (Guide देखें)।',
              ],
              backupFile: r.backupFile,
            };
          }}
          onClose={(done) => {
            setOpen(false);
            if (done) onChanged();
          }}
        />
      )}
    </TaskCard>
  );
}
