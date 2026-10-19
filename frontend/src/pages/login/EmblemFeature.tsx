import { useState } from 'react';

// Decorative Ashoka Pillar above the brand title. To remove the feature: delete <EmblemFeature />
// in BrandPanel.tsx, this file, config/emblem.ts and the "Emblem" block in app.css.
export function EmblemFeature({ src }: { src: string | undefined }) {
  const [failed, setFailed] = useState(false);
  if (src === undefined || failed) return null;
  return (
    <div className="emblem" aria-hidden="true">
      <img
        className="emblem-img"
        src={src}
        alt=""
        onError={() => {
          setFailed(true);
        }}
      />
    </div>
  );
}
