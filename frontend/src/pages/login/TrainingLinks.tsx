import type { TrainingLink } from '../../config/trainingLinks';
import { visibleTrainingLinks } from '../../config/trainingLinks';
import { ArrowIcon } from './icons';
import { LOGIN_TEXTS as T } from './loginTexts';

export function TrainingLinks({ links }: { links: readonly TrainingLink[] }) {
  const shown = visibleTrainingLinks(links);
  if (shown.length === 0) return null;
  return (
    <section className="training-card" aria-labelledby="training-title">
      <h2 id="training-title">
        {T.trainingTitleHi} / <span lang="en">{T.trainingTitleEn}</span>
      </h2>
      <ul className="training-list">
        {shown.map((link) => (
          <li key={link.id}>
            <a className="training-link" href={link.url} target="_blank" rel="noopener noreferrer">
              <span className="training-text">
                <span className="training-en" lang="en">
                  {link.labelEn}
                </span>
                <span className="training-hi">{link.labelHi}</span>
                <span className="visually-hidden">{T.opensInNewTab}</span>
              </span>
              <ArrowIcon />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
