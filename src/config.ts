// All tunable numbers live here. In debug mode lil-gui edits this object live;
// once a value feels right, copy it back into this file.

export const config = {
  camera: {
    width: 640, // higher resolution only slows detection down
    height: 480,
  },
  tracking: {
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  },
  gestures: {
    minPalmSize: 0.06, // hands smaller than this (far away / bystanders) are ignored
    poseConfirmFrames: 3, // a new pose must be seen this many frames in a row
    extendedRatio: 1.1, // finger extended if wrist→tip > wrist→PIP × this
    pinchEnter: 0.3, // thumb–index distance / palm size
    pinchExit: 0.45,
    pinchMinIndexReach: 1.2, // wrist→index tip / palm; a fist measures ~1.0, so it can't read as pinch
    rotateGain: 7, // radians per full camera width of hand movement
    zoomGain: 4, // zoom factor = exp(Δy × gain)
    swipeDistance: 0.8, // ✌️ swipe: palm sizes of sideways travel within swipeWindowMs
    swipeWindowMs: 450,
    vHoldMs: 500, // ✌️ held this long (without swiping) → next planet
    vHoldMaxMove: 0.5, // palm sizes; moving more than this means "swiping", not "holding"
    switchCooldownMs: 800, // min time between planet switches; one ✌️ = one switch
    pointerMargin: 0.15, // camera border not needed to reach screen edges
    dwellMs: 1000,
    hoverGraceMs: 200, // pointer may leave the target this long without resetting dwell
    fistHoldMs: 450,
    timeGain: 3, // time scale factor = (two-hand spread ratio) ^ gain
    handLostMs: 300, // keep the controlling hand this long after it disappears
    // v1.2 gestures (gestures/extras.ts)
    photoHoldMs: 800, // 🤘 held this long → photo
    dialSettleMs: 300, // 🤙 must be held this long before tilting it changes the speed
    dialDegPerHalf: 90, // degrees of 🤙 tilt that sweep half the time slider (stopped ↔ fastest)
    dialPhotoBlockMs: 500, // no 🤘 photo this long after the 🤙 dial ends (the two can be confused)
  },
  smoothing: {
    // Tuned for normalized [0,1] coordinates.
    minCutoff: 1.5, // Hz; lower = smoother when still, more lag
    beta: 5, // higher = less lag when moving fast
  },
  render: {
    exposure: 1.15, // ACES filmic tone mapping exposure
    bloomStrength: 0.9,
    bloomRadius: 0.6,
    bloomThreshold: 1.0, // linear HDR luminance; lit planets stay below it, the Sun is above
  },
  keyboard: {
    rotateStep: 0.12, // radians per key press
    zoomStep: 1.15,
    timeStep: 2,
  },
};

export type Config = typeof config;
