export interface TrainingLink {
  id: string;
  labelEn: string;
  labelHi: string;
  /** An empty url hides the link (no dead buttons). */
  url: string;
}

// TEMPORARY: the link points to our own site until the real training material URL arrives.
// Replace the url here; nothing else needs to change.
export const TRAINING_LINKS: readonly TrainingLink[] = [
  {
    id: 'training',
    labelEn: 'Training Material',
    labelHi: 'प्रशिक्षण सामग्री देखें',
    url: 'https://churuvote.vercel.app/',
  },
];

export function visibleTrainingLinks(links: readonly TrainingLink[]): TrainingLink[] {
  return links.filter((link) => link.url.trim() !== '');
}
