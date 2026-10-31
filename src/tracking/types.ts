// Plain data shapes, shared by the tracker, recorder, gesture code and tests.
// Coordinates are MediaPipe's raw normalized video coords (not mirrored):
// x,y in [0,1] from the top-left of the video frame, z relative depth.

export type Point3 = [x: number, y: number, z: number];

export interface Hand {
  handedness: 'Left' | 'Right';
  score: number;
  landmarks: Point3[]; // 21 points
}

export interface HandFrame {
  t: number; // ms, monotonic
  hands: Hand[];
}
