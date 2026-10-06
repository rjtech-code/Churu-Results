import { createContext, useContext } from 'react';
import { partyColour } from './partyColours';

/** Party short names of the whole screen, so every party gets the same colour everywhere on it. */
export const PartyNames = createContext<readonly string[]>([]);

export function usePartyColour(): (shortName: string | null) => string {
  const names = useContext(PartyNames);
  return (shortName) => partyColour(shortName, names);
}
