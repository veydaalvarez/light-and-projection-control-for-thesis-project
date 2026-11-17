// KEYBOARD SHORTCUTS
// f: Toggle mapping mode (fullscreen)
// c: Toggle corner editing on/off
// s: Save current 4 corners as JSON
// l: Load corners from a JSON file

// NOTE
// You may see this warning in the console. It is expected in this setup and can be ignored:
// p5.js says: [script.js, line 75] texture() was expecting p5.Image|p5.MediaElement|p5.Graphics|p5.Texture|p5.Framebuffer|p5.FramebufferTexture for the first parameter, received object instead.

let mapping;

let faceMesh;
let video;
let faces = [];

let espHost = 'lights.local';
let lastSend = 0;
let sendInterval = 100;

// ---- light behavior (led strip via esp32) ----
let activeMin = 6;          // ~2%
let activeMax = 40;         // ~9%
let breathPeriod = 6.0;     // 3s fade in + 3s fade out

// off / waking / active - a clear off state, a scripted double-blink the moment
// someone first arrives, then normal breathing. this is what makes "it just
// noticed me" unambiguous instead of a continuous dim glow that's easy to miss.
let lightState = 'off';
let wakeTimer = 0;
let wakeDuration = 1.0; // total time for the blink-then-rise sequence
let wasAnyoneHere = false;

let lastPeopleCount = 0;
let flashTimer = 0;
let flashDuration = 0.6;
let flashPeakBrightness = 160;

let presence = 0;

// gaze tracking kept (for the debug overlay / next step) but not driving any
// visual right now
let gazeUpEnter = -0.05;
let gazeUpExit = -0.12;
let gazeState = 'down';
let gazeRatio = 0;

let faceCX = 0;
let faceCY = 0;
let faceW = 150;

let warpAmount = 0.15; // single flat low distortion - the "light morph"

// ---- focus crop - hones in on the closest/largest face when one's detected,
// widens back to the full frame when nobody's there. kept deliberately simple
// (direct faceW * zoom relationship, no auto-calibration) after the more
// elaborate version caused problems. ----
let focusCX, focusCY, focusW, focusH;
let focusZoom = 6;        // crop width = faceW * this, when a face is detected
let focusMinFrac = 0.35;  // crop never tighter than this fraction of canvas width
let focusSmooth = 0.05;   // lower = slower/smoother pan-and-zoom
let videoFull;            // stable full-canvas copy of the camera, source for the crop

// ---- oval mask - everything outside this ellipse stays pure black, for
// projecting onto a physical oval surface without spilling light past its edge.
// fractions of canvas width/height, adjust if your oval isn't a full-bleed ellipse.
let ovalRxFrac = 0.5;
let ovalRyFrac = 0.5;

let meltSize = 200;
let meltSrc;
let meltOut;

let cameraStatus = 'starting';
let showDebug = true;
let showRaw = false; // press 'r' to toggle

function preload() {
  faceMesh = ml5.faceMesh({ maxFaces: 3, refineLandmarks: false, flipHorizontal: false });
}

function setup() {
  let canvas =createCanvas(640, 480);
  mapping = new ProjectionMapping(canvas);

  navigator.mediaDevices.enumerateDevices().then(devices => {
    let cams = devices.filter(d => d.kind === 'videoinput');
    console.log('video input devices:', cams.map(d => d.label || '(unnamed - allow permission to see labels)'));
  });

  startCapture();

  meltSrc = createGraphics(meltSize, meltSize);
  meltSrc.pixelDensity(1); // critical - without this, on a retina display the actual
  // backing buffer is 2x (or 3x) the size requested, and the manual pixel-index math
  // below reads it with the wrong stride - that's what was producing the sheared,
  // interlaced striping in the screenshot
  meltOut = createImage(meltSize, meltSize);

  videoFull = createGraphics(windowWidth, windowHeight);

  focusCX = windowWidth / 2;
  focusCY = windowHeight / 2;
  focusW = windowWidth;
  focusH = windowHeight;
}

function startCapture() {
  navigator.mediaDevices.enumerateDevices().then(devices => {
    let cams = devices.filter(d => d.kind === 'videoinput');
    
    let targetCam = cams.find(c => c.label.includes('HD Pro Webcam C920'));
    
    if (!targetCam) {
      console.warn('C920 not found, falling back to default');
      cameraStatus = 'C920 not found, using default camera';
      targetCam = cams[0];
    }

    let constraints = {
      video: { deviceId: { exact: targetCam.deviceId } }
    };

    video = createCapture(constraints, () => {
      cameraStatus = 'streaming from: ' + targetCam.label;
    });
    video.size(windowWidth, windowHeight);
    video.hide();
    faceMesh.detectStart(video, gotFaces);
  });
}

function windowResized() {
  //resizeCanvas(windowWidth, windowHeight);
  //videoFull.remove();
  //videoFull = createGraphics(windowWidth, windowHeight);
}

function gotFaces(results) {
  faces = results;
}

function keyPressed() {
  if (key === 'd' || key === 'D') showDebug = !showDebug;
  if (key === 'r' || key === 'R') showRaw = !showRaw;
}

function draw() {
  if (!video) {
    background(10);
    drawDebug();
    return;
  }

  let peopleCount = faces.length;
  let detected = peopleCount > 0;
  presence = lerp(presence, detected ? 1 : 0, 0.04);
  let presenceActive = presence > 0.5; // hysteresis comes from presence's slow lerp,
  // not this threshold - this is what keeps a single dropped detection frame from
  // snapping the light to off and restarting the wake sequence

  if (peopleCount > lastPeopleCount) flashTimer = flashDuration;
  lastPeopleCount = peopleCount;
  flashTimer = max(0, flashTimer - deltaTime / 1000);

  let primary = null;
  let maxW = 0;
  let maxRatio = -Infinity;
  for (let f of faces) {
    let kp = f.keypoints;
    let interOc = dist(kp[33].x, kp[33].y, kp[263].x, kp[263].y);
    let w = interOc * 4;
    if (w > maxW) { maxW = w; primary = f; }
    let r = getGazeRatio(kp, interOc);
    if (r !== null && r > maxRatio) maxRatio = r;
  }
  if (primary) {
    let kp = primary.keypoints;
    faceCX = kp[1].x;
    faceCY = kp[1].y;
    faceW = maxW;
  }
  if (maxRatio > -Infinity) {
    gazeRatio = maxRatio;
    if (gazeState === 'down' && gazeRatio > gazeUpEnter) gazeState = 'up';
    else if (gazeState === 'up' && gazeRatio < gazeUpExit) gazeState = 'down';
  } else {
    gazeState = 'down';
  }

  if (presenceActive && !wasAnyoneHere) {
    lightState = 'waking';
    wakeTimer = 0;
  } else if (!presenceActive) {
    lightState = 'off';
  }
  wasAnyoneHere = presenceActive;

  if (lightState === 'waking') {
    wakeTimer += deltaTime / 1000;
    if (wakeTimer >= wakeDuration) lightState = 'active';
  }

  videoFull.image(video, 0, 0, width, height);
  let crop = updateFocus(detected);

  background(0); // pure black, full canvas, unclipped - nothing projects here

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.ellipse(width / 2, height / 2, width * ovalRxFrac, height * ovalRyFrac, 0, 0, TWO_PI);
  drawingContext.clip();

  if (showRaw) {
    image(videoFull, 0, 0, width, height, crop.cropX, crop.cropY, crop.cropW, crop.cropH);
  } else {
    updateMelt(warpAmount, crop.cropX, crop.cropY, crop.cropW, crop.cropH);
    drawBase();
  }

  drawingContext.restore();

  let targetBrightness;
  let t = millis() / 1000;
  let breathing = map(sin(t * (TWO_PI / breathPeriod)), -1, 1, activeMin, activeMax);

  if (lightState === 'off') {
    targetBrightness = 0;
  } else if (lightState === 'waking') {
    // double-blink, then rise into the live breathing value
    let wt = wakeTimer;
    if (wt < 0.15) targetBrightness = activeMax;
    else if (wt < 0.30) targetBrightness = 0;
    else if (wt < 0.45) targetBrightness = activeMax;
    else if (wt < 0.60) targetBrightness = 0;
    else {
      let riseAmt = constrain((wt - 0.60) / (wakeDuration - 0.60), 0, 1);
      targetBrightness = lerp(0, breathing, riseAmt);
    }
  } else {
    // active - normal breathing, plus a lighter pulse if someone additional joins
    targetBrightness = breathing;
    let flashAmt = flashTimer / flashDuration;
    targetBrightness = lerp(targetBrightness, flashPeakBrightness, flashAmt);
  }
  sendBrightness(targetBrightness);

  drawDebug();
}

function getGazeRatio(kp, interOc) {
  let nose = kp[1];
  let leftEye = kp[159];
  let rightEye = kp[386];
  if (!nose || !leftEye || !rightEye || interOc < 1) return null;
  let eyeMidY = (leftEye.y + rightEye.y) / 2;
  return (eyeMidY - nose.y) / interOc;
}

function updateFocus(detected) {
  let targetCX, targetCY, targetW, targetH;
  if (detected) {
    targetW = constrain(faceW * focusZoom, width * focusMinFrac, width);
    targetH = targetW * (height / width); // keep canvas aspect ratio
    targetCX = faceCX;
    targetCY = faceCY;
  } else {
    targetW = width;
    targetH = height;
    targetCX = width / 2;
    targetCY = height / 2;
  }

  focusCX = lerp(focusCX, targetCX, focusSmooth);
  focusCY = lerp(focusCY, targetCY, focusSmooth);
  focusW = lerp(focusW, targetW, focusSmooth);
  focusH = lerp(focusH, targetH, focusSmooth);

  let cropW = constrain(focusW, 40, width);
  let cropH = constrain(focusH, 40, height);
  let cropX = constrain(focusCX - cropW / 2, 0, width - cropW);
  let cropY = constrain(focusCY - cropH / 2, 0, height - cropH);

  return { cropX, cropY, cropW, cropH };
}

function updateMelt(warpAmount, cropX, cropY, cropW, cropH) {
  meltSrc.image(videoFull, 0, 0, meltSize, meltSize, cropX, cropY, cropW, cropH);
  meltSrc.loadPixels();
  meltOut.loadPixels();

  let t = millis() / 1000;

  for (let y = 0; y < meltSize; y++) {
    let ny = y / meltSize;
    for (let x = 0; x < meltSize; x++) {
      let nx = x / meltSize;

      let n1 = noise(nx * 4, ny * 4, t * 0.4);
      let n2 = noise(nx * 6 + 50, ny * 6 + 50, t * 0.3);

      let dx = (n1 - 0.5) * 16 * warpAmount;
      let dy = ((n2 - 0.5) * 12 + ny * 10) * warpAmount;

      let sx = constrain(round(x + dx), 0, meltSize - 1);
      let sy = constrain(round(y + dy), 0, meltSize - 1);

      let srcIdx = (sy * meltSize + sx) * 4;
      let dstIdx = (y * meltSize + x) * 4;

      meltOut.pixels[dstIdx] = meltSrc.pixels[srcIdx];
      meltOut.pixels[dstIdx + 1] = meltSrc.pixels[srcIdx + 1];
      meltOut.pixels[dstIdx + 2] = meltSrc.pixels[srcIdx + 2];
      meltOut.pixels[dstIdx + 3] = 255;
    }
  }

  meltOut.updatePixels();
}

function drawBase() {
  background(15, 15, 17);

  push();
  tint(225, 225, 228);
  image(meltOut, 0, 0, width, height);
  pop();

  noStroke();
  fill(235, 233, 230, 18);
  rect(0, 0, width, height);
}

function drawDebug() {
  if (!showDebug) return;
  push();
  fill(0, 200);
  noStroke();
  rect(0, height - 168, 420, 168);
  fill(255, 255, 0);
  textSize(13);
  text('cam: ' + cameraStatus, 10, height - 148);
  text('people: ' + faces.length + '  presence: ' + presence.toFixed(2), 10, height - 130);
  text('gaze ratio: ' + gazeRatio.toFixed(3) + '  state: ' + gazeState, 10, height - 112);
  text('flash timer: ' + flashTimer.toFixed(2) + 's   light: ' + lightState + ' (' + wakeTimer.toFixed(2) + 's)', 10, height - 94);
  text('focus crop w: ' + Math.round(focusW) + '  faceW: ' + Math.round(faceW), 10, height - 76);
  text('mode: ' + (showRaw ? 'RAW CAMERA (cropped, no warp)' : 'warped (melt only)'), 10, height - 58);
  text('press r to toggle raw vs warped', 10, height - 40);
  text('press d to hide this', 10, height - 22);
  pop();
}

function sendBrightness(value) {
  let now = millis();
  if (now - lastSend < sendInterval) return;
  lastSend = now;
  let b = round(value);
  fetch('http://' + espHost + '/set?b=' + b, { mode: 'no-cors' }).catch(err => console.log('send failed', err));
}
