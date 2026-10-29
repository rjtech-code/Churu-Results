import { PageIntro } from '../../components/AdminParts';
import '../../styles/admin.css';
import '../../styles/superadmin.css';
import { GUIDE, GUIDE_TITLE } from './guideContent';

/** मार्गदर्शिका: plain text from guideContent.ts (Super Admin and DM). */
export function GuidePage() {
  return (
    <article className="sa-guide">
      <PageIntro title={GUIDE_TITLE} hint="Super Admin और DM के लिए — कौन-सा काम कब और किस क्रम में करें।" />
      {GUIDE.map((s) => {
        const List = s.numbered === true ? 'ol' : 'ul';
        return (
          <section key={s.id} id={s.id} className="admin-section">
            <h2>{s.heading}</h2>
            {s.text?.map((t) => (
              <p key={t}>{t}</p>
            ))}
            {s.steps && (
              <List>
                {s.steps.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </List>
            )}
          </section>
        );
      })}
    </article>
  );
}
