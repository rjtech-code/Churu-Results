import { EMBLEM_URL } from '../../config/emblem';
import { TRAINING_LINKS } from '../../config/trainingLinks';
import { EmblemFeature } from './EmblemFeature';
import { LOGIN_TEXTS as T } from './loginTexts';
import { TrainingLinks } from './TrainingLinks';

export function BrandPanel() {
  return (
    <section className="brand-panel" aria-labelledby="brand-title">
      <EmblemFeature src={EMBLEM_URL} />
      <div className="brand-head">
        <p id="brand-title" className="brand-title">
          {T.brandTitle}
        </p>
        <p className="brand-subtitle">{T.brandSubtitle}</p>
        <p className="brand-en" lang="en">
          {T.brandEn}
        </p>
        <div className="brand-divider" aria-hidden="true" />
      </div>
      <TrainingLinks links={TRAINING_LINKS} />
    </section>
  );
}
