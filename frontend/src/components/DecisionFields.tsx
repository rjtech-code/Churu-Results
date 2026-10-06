import type { WardResult, WouldStore } from '../api/types';

export interface Decision {
  lotteryWinner: number | null;
  conductedBy: string;
  note: string;
  notaAck: boolean;
  password: string;
}

export const emptyDecision: Decision = {
  lotteryWinner: null,
  conductedBy: '',
  note: '',
  notaAck: false,
  password: '',
};

/** Problems the operator must fix before declaring (the server checks again). */
export function decisionProblem(store: WouldStore, d: Decision): string | null {
  if (store.needsLottery) {
    if (d.lotteryWinner === null) return 'बराबरी है — लॉटरी में जीते उम्मीदवार को चुनें';
    if (d.conductedBy.trim().length < 3) return 'लॉटरी किसने कराई — कम से कम 3 अक्षर लिखें';
    if (d.note.trim().length < 10) return 'लॉटरी का विवरण कम से कम 10 अक्षर में लिखें';
  }
  if (store.notaHighest && !d.notaAck) return 'नोटा को सर्वाधिक मत — पुष्टि का बॉक्स चुनें';
  if (d.password === '') return 'अपना पासवर्ड लिखें';
  return null;
}

/** The body fields shared by declare and correction, built from the preview the operator saw. */
export function decisionBody(result: WardResult, store: WouldStore, d: Decision) {
  const winner = store.needsLottery ? d.lotteryWinner : store.winnerCandidateId;
  return {
    password: d.password,
    confirmWinnerCandidateId: winner ?? 0,
    confirmTotalValidVotes: result.totalValidVotes,
    ...(store.needsLottery && d.lotteryWinner !== null
      ? {
          lottery: {
            winnerCandidateId: d.lotteryWinner,
            conductedBy: d.conductedBy.trim(),
            note: d.note.trim(),
          },
        }
      : {}),
    ...(store.notaHighest && d.notaAck ? { acknowledgeNotaHighest: true } : {}),
  };
}

export function ResultTable({ result }: { result: WardResult }) {
  const rows = [...result.candidates].sort(
    (a, b) => Number(a.isNota) - Number(b.isNota) || b.totalVotes - a.totalVotes,
  );
  return (
    <table className="list">
      <thead>
        <tr>
          <th>स्थान</th>
          <th>उम्मीदवार</th>
          <th>बूथ मत</th>
          <th>डाक मत</th>
          <th>कुल मत</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className={c.isNota ? 'nota-row' : undefined}>
            <td className="numcell">{c.rank ?? '—'}</td>
            <td>{c.isNota ? 'नोटा' : c.nameHindi}</td>
            <td className="numcell">{c.boothVotes}</td>
            <td className="numcell">{c.postalVotes}</td>
            <td className="numcell">
              <strong>{c.totalVotes}</strong>
            </td>
          </tr>
        ))}
        <tr className="total-row">
          <td colSpan={4}>कुल वैध मत</td>
          <td className="numcell" data-testid="total-valid">
            {result.totalValidVotes}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Lottery (ties only), NOTA acknowledgement (NOTA highest only) and the password re-check. */
export function DecisionFields({
  result,
  store,
  value,
  onChange,
}: {
  result: WardResult;
  store: WouldStore;
  value: Decision;
  onChange: (d: Decision) => void;
}) {
  const tied = result.candidates.filter((c) => store.tiedCandidateIds.includes(c.id));
  return (
    <div className="decision">
      {store.needsLottery && (
        <fieldset className="lottery">
          <legend>बराबरी — लॉटरी का परिणाम</legend>
          <p>
            शीर्ष उम्मीदवारों के मत बराबर हैं। नियमानुसार लॉटरी कराएँ, फिर उसका परिणाम यहाँ भरें। सिस्टम खुद
            विजेता नहीं चुनता।
          </p>
          {tied.map((c) => (
            <label key={c.id} className="radio">
              <input
                type="radio"
                name="lottery-winner"
                checked={value.lotteryWinner === c.id}
                onChange={() => {
                  onChange({ ...value, lotteryWinner: c.id });
                }}
              />{' '}
              {c.nameHindi} ({c.totalVotes} मत)
            </label>
          ))}
          <label htmlFor="lottery-by">लॉटरी किसने कराई (3–100 अक्षर)</label>
          <input
            id="lottery-by"
            maxLength={100}
            value={value.conductedBy}
            onChange={(e) => {
              onChange({ ...value, conductedBy: e.target.value });
            }}
          />
          <label htmlFor="lottery-note">लॉटरी का विवरण (10–500 अक्षर)</label>
          <textarea
            id="lottery-note"
            rows={2}
            maxLength={500}
            value={value.note}
            onChange={(e) => {
              onChange({ ...value, note: e.target.value });
            }}
          />
        </fieldset>
      )}
      {store.notaHighest && (
        <div className="msg msg-error">
          <p>
            ! ध्यान दें: <strong>नोटा को सबसे अधिक मत ({result.notaVotes})</strong> मिले हैं। आधिकारिक नियम की
            पुष्टि अभी बाकी है; विजेता का तर्क नहीं बदलता।
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.notaAck}
              onChange={(e) => {
                onChange({ ...value, notaAck: e.target.checked });
              }}
            />{' '}
            मैंने नोटा के सर्वाधिक मत देख लिए हैं और घोषणा जारी रखना चाहता/चाहती हूँ
          </label>
        </div>
      )}
      <label htmlFor="reauth-password">अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)</label>
      <input
        id="reauth-password"
        type="password"
        autoComplete="current-password"
        value={value.password}
        onChange={(e) => {
          onChange({ ...value, password: e.target.value });
        }}
      />
    </div>
  );
}
