import type { LandmarkId } from './spaceportCollision';

/**
 * What each place button promises to show, and the evidence in the shipped asset that it does.
 * tests/spaceportPlaces.test.ts checks every shown place against assets/spaceport-m03/site-authoring.json and
 * public/spaceport/tanegashima-m03.glb, so a new spaceport export fails the test until this table matches it
 */
export type PlaceEvidence =
  /** The landmark's authoring entry names this object (buildings). */
  | { kind: 'authoringObject'; object: string }
  /**
   * As authoringObject, and the object is also a collision object whose exported collider (its real geometry's
   * bounds, written by the exporter) lies inside the landmark: the building is in the shipped scene, not only named.
   */
  | { kind: 'exportedObject'; object: string }
  /** A GLB node with this name sits inside the landmark bounds (the launch stack). */
  | { kind: 'nodeInBounds'; node: string }
  /** A GLB mesh whose material name matches lies inside the landmark bounds (flat site markings). */
  | { kind: 'materialInBounds'; material: string };

export interface SpaceportPlace {
  id: LandmarkId;
  /** false hides the button and ignores taps on the area, e.g. until a landing pad exists. */
  shown: boolean;
  /** The main thing the camera shows, in plain words (for reviewers; not displayed). */
  mainObject: string;
  evidence: PlaceEvidence;
}

export const SPACEPORT_PLACES: readonly SpaceportPlace[] = [
  { id: 'assembly', shown: true, mainObject: 'Coastal passenger terminal (swept roof)', evidence: { kind: 'exportedObject', object: 'Hero terminal | main swept roof' } },
  { id: 'control', shown: true, mainObject: 'Coastal control tower', evidence: { kind: 'exportedObject', object: 'Control | tapered ceramic shaft' } },
  { id: 'pad', shown: true, mainObject: 'Launch stack on the pad', evidence: { kind: 'nodeInBounds', node: 'CTRL | Shuttle ascent' } },
  // The landing pad remains a mission destination and has no Launch Preview chip.
  { id: 'landing', shown: false, mainObject: 'Landing Zone 02', evidence: { kind: 'materialInBounds', material: 'Landing guidance' } },
];

export const shownPlaces = (): LandmarkId[] => SPACEPORT_PLACES.filter(place => place.shown).map(place => place.id);
export const isShownPlace = (id: LandmarkId): boolean => SPACEPORT_PLACES.some(place => place.id === id && place.shown);
