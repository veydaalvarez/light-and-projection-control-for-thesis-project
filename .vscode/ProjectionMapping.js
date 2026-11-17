// ProjectionMapping for p5.js
// J.H. Moon, IMA, NYU Shanghai

class ProjectionMapping {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;

    this.mappingCanvas = null;

    this.corners = [
      { x: -this.width / 2, y: -this.height / 2 },
      { x: this.width / 2, y: -this.height / 2 },
      { x: this.width / 2, y: this.height / 2 },
      { x: -this.width / 2, y: this.height / 2 },
    ];

    this.selectedCorner = -1;
    this.cornerRadius = 10;
    this.isCornerEditing = true;
    this.isMappingMode = false;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);

    this.createMappingToggleNote();

    this.p5 = new p5((p) => {
      p.setup = () => {
        const cnv = p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
        this.mappingCanvas = cnv;
        this.setupEventListeners(cnv.elt, p);
        this.applyPresentationModeStyles();
      };
      p.windowResized = () => {
        if (!this.isMappingMode) return;
        this.resizeMappingCanvasToWindow();
      };
      p.draw = () => {
        p.background(0);
        this.render(p);
        if (this.isCornerEditing) {
          this.drawCorners(p);
        }
      };
    });
  }

  render(p) {
    p.push();
    p.noStroke();
    p.texture(this.canvas);
    this.drawSubdividedMesh(p);
    p.pop();
  }

  createMappingToggleNote() {
    const noteId = "mapping-toggle-note";
    if (document.getElementById(noteId)) return;

    const note = document.createElement("div");
    note.id = noteId;
    note.textContent = 'Press "F" to Toggle Fullscreen and Projection Mapping!';
    document.body.appendChild(note);

    console.warn(
      "Ignore the p5 texture() warning below. Projection mapping remains functional with this renderer source."
    );
  }

  setupEventListeners(el, p) {
    window.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);

    el.addEventListener("mousedown", (e) => {
      if (this.onMousePressed(e.offsetX, e.offsetY, p)) {
        e.preventDefault();
      }
    });

    el.addEventListener("mousemove", (e) => {
      if ((e.buttons & 1) === 0) return;
      if (this.onMouseDragged(e.offsetX, e.offsetY, p)) {
        e.preventDefault();
      }
    });

    el.addEventListener("mouseup", () => this.onMouseReleased());
    el.addEventListener("mouseleave", () => this.onMouseReleased());
  }

  screenToWorld(mx, my, p) {
    return { x: mx - p.width / 2, y: my - p.height / 2 };
  }

  onMousePressed(mx, my, p) {
    if (!this.isCornerEditing) return false;
    const world = this.screenToWorld(mx, my, p);
    return this.checkPointHit(world.x, world.y, p);
  }

  onMouseDragged(mx, my, p) {
    if (this.selectedCorner === -1 || !this.isCornerEditing) return false;
    const world = this.screenToWorld(mx, my, p);
    this.dragPoint(world.x, world.y);
    return true;
  }

  onMouseReleased() {
    this.selectedCorner = -1;
  }

  bilinearInterpolate(u, v) {
    const c = this.corners;
    return {
      x:
        (1 - u) * (1 - v) * c[0].x +
        u * (1 - v) * c[1].x +
        u * v * c[2].x +
        (1 - u) * v * c[3].x,
      y:
        (1 - u) * (1 - v) * c[0].y +
        u * (1 - v) * c[1].y +
        u * v * c[2].y +
        (1 - u) * v * c[3].y,
    };
  }

  drawSubdividedMesh(p, segments = 32) {
    for (let row = 0; row < segments; row++) {
      p.beginShape(p.TRIANGLE_STRIP);
      for (let col = 0; col <= segments; col++) {
        const u = col / segments;
        for (const v of [row / segments, (row + 1) / segments]) {
          const pt = this.bilinearInterpolate(u, v);
          p.vertex(pt.x, pt.y, u * this.width, v * this.height);
        }
      }
      p.endShape();
    }
  }

  drawCorners(p) {
    p.push();
    p.stroke(255);
    p.strokeWeight(2);
    p.noFill();

    p.line(
      this.corners[0].x,
      this.corners[0].y,
      0,
      this.corners[1].x,
      this.corners[1].y,
      0
    );
    p.line(
      this.corners[1].x,
      this.corners[1].y,
      0,
      this.corners[2].x,
      this.corners[2].y,
      0
    );
    p.line(
      this.corners[2].x,
      this.corners[2].y,
      0,
      this.corners[3].x,
      this.corners[3].y,
      0
    );
    p.line(
      this.corners[3].x,
      this.corners[3].y,
      0,
      this.corners[0].x,
      this.corners[0].y,
      0
    );

    for (let i = 0; i < this.corners.length; i++) {
      const corner = this.corners[i];
      p.push();
      p.translate(corner.x, corner.y, 1);

      if (i === this.selectedCorner) {
        p.noStroke();
        p.fill(0, 255, 0);
        p.circle(0, 0, this.cornerRadius * 2);

        p.noFill();
        p.stroke(0, 255, 0);
        p.circle(0, 0, this.cornerRadius * 4);
      } else {
        p.noStroke();
        p.noFill();
        p.stroke(255);
        p.circle(0, 0, this.cornerRadius * 2);
      }

      p.pop();
    }
    p.pop();
  }

  checkPointHit(mx, my, p) {
    for (let i = 0; i < this.corners.length; i++) {
      const corner = this.corners[i];
      if (p.dist(mx, my, corner.x, corner.y) < this.cornerRadius * 1.5) {
        this.selectedCorner = i;
        return true;
      }
    }
    this.selectedCorner = -1;
    return false;
  }

  dragPoint(mx, my) {
    if (this.selectedCorner !== -1) {
      this.corners[this.selectedCorner].x = mx;
      this.corners[this.selectedCorner].y = my;
    }
  }

  getMappedSourcePoint(mx, my) {
    if (!this.isMappingMode) {
      return { x: mx, y: my };
    }

    // convert screen coordinates to WEBGL center-origin coordinates
    let p = this.p5;
    const worldX = mx - p.width / 2;
    const worldY = my - p.height / 2;

    let uv = this.estimateUV(worldX, worldY);

    return {
      x: uv.u * this.width,
      y: uv.v * this.height,
    };
  }

  estimateUV(qx, qy) {
    const c = this.corners;
    const cross = (v1, v2) => v1.x * v2.y - v1.y * v2.x;

    // standard vectors for inverse bilinear interpolation
    let E = { x: c[1].x - c[0].x, y: c[1].y - c[0].y };
    let F = { x: c[3].x - c[0].x, y: c[3].y - c[0].y };
    let G = {
      x: c[0].x - c[1].x + c[2].x - c[3].x,
      y: c[0].y - c[1].y + c[2].y - c[3].y,
    };
    let H = { x: qx - c[0].x, y: qy - c[0].y };

    // coefficients for the quadratic equation: k2 * v^2 + k1 * v + k0 = 0
    let k2 = cross(G, F);
    let k1 = cross(E, F) + cross(H, G);
    let k0 = cross(H, E);

    let u = 0;
    let v = 0;

    // solve quadratic for v
    if (Math.abs(k2) < 0.00001) {
      // if the quadrilateral is basically a parallelogram
      v = -k0 / k1;
    } else {
      let det = k1 * k1 - 4 * k2 * k0;
      if (det < 0) {
        // fallback if the point is completely outside and calculation breaks
        v = 0;
      } else {
        let sqrtDet = Math.sqrt(det);
        let v1 = (-k1 + sqrtDet) / (2 * k2);
        let v2 = (-k1 - sqrtDet) / (2 * k2);

        // select the root that falls within the 0 to 1 range
        if (v1 >= 0 && v1 <= 1) v = v1;
        else if (v2 >= 0 && v2 <= 1) v = v2;
        else v = v1;
      }
    }

    // solve for u using the result of v
    let denomX = E.x + v * G.x;
    let denomY = E.y + v * G.y;

    // use the larger denominator to prevent division by zero or huge errors
    if (Math.abs(denomX) > Math.abs(denomY)) {
      u = (H.x - v * F.x) / denomX;
    } else {
      u = (H.y - v * F.y) / denomY;
    }

    return {
      u: Math.min(1, Math.max(0, u)),
      v: Math.min(1, Math.max(0, v)),
    };
  }

  handleKeyDown(event) {
    const key = event.key.toLowerCase();

    if (key === "f") {
      this.togglePresentationMode();
      return;
    }

    if (key === "c") {
      this.toggleCornerEditing();
      return;
    }

    //     if (key === "s") {
    //       this.saveCornersToJson();
    //       return;
    //     }

    //     if (key === "l") {
    //       this.loadCornersFromJson();
    //     }
  }

  toggleCornerEditing() {
    this.isCornerEditing = !this.isCornerEditing;
    this.onMouseReleased();
    console.log(`Corner editing: ${this.isCornerEditing ? "ON" : "OFF"}`);
  }

  togglePresentationMode() {
    this.isMappingMode = !this.isMappingMode;
    this.applyPresentationModeStyles();

    if (this.p5) {
      this.p5.fullscreen(this.isMappingMode);
      requestAnimationFrame(() => this.resizeMappingCanvasToWindow());
    }
  }

  handleFullscreenChange() {
    this.resizeMappingCanvasToWindow();

    if (!document.fullscreenElement && this.isMappingMode) {
      this.isMappingMode = false;
      this.applyPresentationModeStyles();
    }
  }

  resizeMappingCanvasToWindow() {
    if (!this.p5) return;

    const newW = this.p5.windowWidth;
    const newH = this.p5.windowHeight;

    if (this.p5.width === newW && this.p5.height === newH) return;

    this.p5.resizeCanvas(newW, newH);
  }

  applyPresentationModeStyles() {
    if (!this.mappingCanvas) return;
    const canvasStyle = this.mappingCanvas.elt.style;

    if (this.isMappingMode) {
      this.mappingCanvas.show();
      canvasStyle.position = "fixed";
      canvasStyle.left = "0";
      canvasStyle.top = "0";
      canvasStyle.width = "100vw";
      canvasStyle.height = "100vh";
      canvasStyle.zIndex = "9999";
    } else {
      this.mappingCanvas.hide();
      canvasStyle.position = "";
      canvasStyle.left = "";
      canvasStyle.top = "";
      canvasStyle.width = "";
      canvasStyle.height = "";
      canvasStyle.zIndex = "";
    }
  }

  saveCornersToJson() {
    const corners = this.corners.map((corner) => ({
      x: corner.x,
      y: corner.y,
    }));

    const payload = JSON.stringify({ corners }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projection-corners.json";
    a.click();
    URL.revokeObjectURL(url);

    console.log("Saved corners to projection-corners.json");
  }

  async loadCornersFromJson() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "JSON Files",
              accept: { "application/json": [".json"] },
            },
          ],
        });

        const file = await handle.getFile();
        const text = await file.text();
        this.applyLoadedCorners(text);
      } catch (error) {
        if (error && error.name === "AbortError") {
          console.warn("Load cancelled: no file selected.");
          return;
        }
        console.warn("Failed to load corner file:", error);
      }
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        console.warn("Load cancelled: no file selected.");
        return;
      }

      try {
        const text = await file.text();
        this.applyLoadedCorners(text);
      } catch (error) {
        console.warn("Failed to read corner file:", error);
      }
    };
    input.click();
  }

  applyLoadedCorners(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      const corners = Array.isArray(parsed) ? parsed : parsed.corners;

      if (!Array.isArray(corners) || corners.length !== 4) {
        throw new Error("Invalid corner data shape");
      }

      this.corners = corners.map((corner) => ({
        x: Number(corner.x),
        y: Number(corner.y),
      }));

      console.log("Loaded corners from JSON file");
    } catch (error) {
      console.warn("Failed to parse corner data:", error);
    }
  }
}
