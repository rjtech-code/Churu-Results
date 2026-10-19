// The Ashoka Pillar image on the login page (decorative). To replace it, put the new file at the
// path below. If the file is missing, EMBLEM_URL is undefined and the page shows no image; the build
// still passes (import.meta.glob matches nothing instead of failing like a plain import would).
// import.meta.glob needs a literal path, so this call is the one place the path lives.
const found = import.meta.glob<string>('../assets/ashoka-pillar.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const EMBLEM_URL: string | undefined = Object.values(found)[0];
