// Timeline editor: 4 lane rows on a canvas. Rendering (grid/notes/playhead)
// plus the mouse interaction state machine (add/move/resize/delete/select).
import { LANES } from "./chart.js";

const NOTE_W = 14;          // tap width (px)
const NOTE_H_FRAC = 0.55;   // note height as fraction of lane height
const EDGE_GRAB = 6;        // hold right-edge resize zone (px)
const DRAG_THRESHOLD = 5;   // px before a mousedown becomes a drag
const MIN_ZOOM = 20, MAX_ZOOM = 1000; // px per second

const LANE_COLORS = ["#e05561", "#d8a657", "#57b3d8", "#8ec07c"];
const LANE_KEYS = ["D", "F", "J", "K"];

export class Editor {
  constructor(canvas, chart, view) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.chart = chart;
    this.view = view;              // { start, pps } shared with waveform
    this.snapDivision = 4;         // subdivisions per beat (0 = off via Alt)
    this.selection = new Set();
    this.drag = null;              // interaction state machine
    this.mouse = { x: 0, y: 0, inside: false };
    this.getDuration = () => 0;
    this.onEdit = () => {};

    canvas.addEventListener("mousedown", (e) => this._onMouseDown(e));
    window.addEventListener("mousemove", (e) => this._onMouseMove(e));
    window.addEventListener("mouseup", (e) => this._onMouseUp(e));
    canvas.addEventListener("mouseenter", () => (this.mouse.inside = true));
    canvas.addEventListener("mouseleave", () => (this.mouse.inside = false));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
  }

  // --- coordinate helpers ---
  get laneH() { return this.canvas.clientHeight / LANES; }
  xToTime(x) { return this.view.start + x / this.view.pps; }
  timeToX(t) { return (t - this.view.start) * this.view.pps; }
  yToLane(y) { return Math.max(0, Math.min(LANES - 1, Math.floor(y / this.laneH))); }
  laneToY(lane) { return (lane + 0.5) * this.laneH; }

  snap(t, e) {
    if (e && e.altKey) return t;
    return this.chart.snapTime(t, this.snapDivision);
  }

  _localPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // --- hit testing ---
  _hitTest(x, y) {
    const t = this.xToTime(x);
    const lane = this.yToLane(y);
    const halfW = (NOTE_W / 2 + 2) / this.view.pps;
    // Iterate in reverse so later (topmost-drawn) notes win
    for (let i = this.chart.notes.length - 1; i >= 0; i--) {
      const n = this.chart.notes[i];
      if (n.lane !== lane) continue;
      if (n.type === "hold") {
        const endX = this.timeToX(n.t + n.d);
        if (Math.abs(x - endX) <= EDGE_GRAB) return { note: n, mode: "resize" };
        if (t >= n.t - halfW && t <= n.t + n.d) return { note: n, mode: "move" };
      } else if (Math.abs(t - n.t) <= halfW) {
        return { note: n, mode: "move" };
      }
    }
    return null;
  }

  // --- mouse state machine ---
  _onMouseDown(e) {
    const { x, y } = this._localPos(e);
    this.canvas.focus?.();
    if (e.button === 1) {
      this.drag = { kind: "pan", startX: x, viewStart0: this.view.start };
      e.preventDefault();
      return;
    }
    const hit = this._hitTest(x, y);
    if (e.button === 2) {
      if (hit) {
        const doomed = this.selection.has(hit.note) ? [...this.selection] : [hit.note];
        this.selection.clear();
        this.chart.removeNotes(doomed);
        this.onEdit();
      }
      return;
    }
    if (e.button !== 0) return;

    if (hit && hit.mode === "resize") {
      this.drag = { kind: "resize", note: hit.note, orig: { d: hit.note.d } };
      return;
    }
    if (hit) {
      if (e.shiftKey) {
        this.selection.has(hit.note) ? this.selection.delete(hit.note) : this.selection.add(hit.note);
        return;
      }
      if (!this.selection.has(hit.note)) {
        this.selection.clear();
        this.selection.add(hit.note);
      }
      this.drag = {
        kind: "maybe-move",
        startX: x, startY: y,
        anchor: hit.note,
        originals: new Map([...this.selection].map((n) => [n, { t: n.t, lane: n.lane, d: n.d }])),
      };
      return;
    }
    // Empty space
    if (e.shiftKey) {
      this.drag = { kind: "marquee", x0: x, y0: y, x1: x, y1: y };
    } else {
      this.selection.clear();
      this.drag = { kind: "maybe-add", startX: x, startY: y, lane: this.yToLane(y), t: this.snap(this.xToTime(x), e) };
    }
  }

  _onMouseMove(e) {
    const { x, y } = this._localPos(e);
    this.mouse.x = x; this.mouse.y = y;
    const d = this.drag;
    if (!d) {
      // Cursor feedback for hold edges
      const hit = this.mouse.inside ? this._hitTest(x, y) : null;
      this.canvas.style.cursor = hit ? (hit.mode === "resize" ? "ew-resize" : "grab") : "crosshair";
      return;
    }

    if (d.kind === "pan") {
      this.view.start = Math.max(0, d.viewStart0 - (x - d.startX) / this.view.pps);
      return;
    }
    if (d.kind === "marquee") { d.x1 = x; d.y1 = y; return; }

    if (d.kind === "maybe-add" && Math.abs(x - d.startX) > DRAG_THRESHOLD) {
      d.kind = "add-hold";
    }
    if (d.kind === "add-hold") {
      const end = this.snap(this.xToTime(x), e);
      d.holdEnd = Math.max(end, d.t);
      return;
    }

    if (d.kind === "maybe-move" && Math.hypot(x - d.startX, y - d.startY) > DRAG_THRESHOLD) {
      d.kind = "move";
    }
    if (d.kind === "move") {
      // Time delta from the anchor's snapped new position; lane delta from rows
      const anchorOrig = d.originals.get(d.anchor);
      const rawT = anchorOrig.t + (x - d.startX) / this.view.pps;
      const dt = this.snap(rawT, e) - anchorOrig.t;
      const dLane = this.yToLane(y) - this.yToLane(d.startY);
      for (const [n, o] of d.originals) {
        n.t = Math.max(0, o.t + dt);
        n.lane = Math.max(0, Math.min(LANES - 1, o.lane + dLane));
      }
      return;
    }
    if (d.kind === "resize") {
      const n = d.note;
      const end = e.altKey ? this.xToTime(x) : this.snap(this.xToTime(x), e);
      n.d = Math.max(0.01, end - n.t);
      return;
    }
  }

  _onMouseUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const { x, y } = this._localPos(e);

    if (d.kind === "marquee") {
      const t0 = this.xToTime(Math.min(d.x0, d.x1)), t1 = this.xToTime(Math.max(d.x0, d.x1));
      const l0 = this.yToLane(Math.min(d.y0, d.y1)), l1 = this.yToLane(Math.max(d.y0, d.y1));
      for (const n of this.chart.notes) {
        const end = n.type === "hold" ? n.t + n.d : n.t;
        if (end >= t0 && n.t <= t1 && n.lane >= l0 && n.lane <= l1) this.selection.add(n);
      }
      return;
    }
    if (d.kind === "maybe-add") {
      const t = Math.max(0, d.t);
      if (t <= this.getDuration()) {
        this.chart.addNote({ t, lane: d.lane, type: "tap" });
        this.onEdit();
      }
      return;
    }
    if (d.kind === "add-hold") {
      const t = Math.max(0, d.t);
      const dur = (d.holdEnd ?? t) - t;
      if (dur > 0.02) this.chart.addNote({ t, lane: d.lane, type: "hold", d: dur });
      else this.chart.addNote({ t, lane: d.lane, type: "tap" });
      this.onEdit();
      return;
    }
    if (d.kind === "move") {
      // Revert live preview, then commit as one undoable command
      const edits = [];
      for (const [n, o] of d.originals) {
        const final = { note: n, t: n.t, lane: n.lane };
        n.t = o.t; n.lane = o.lane;
        if (final.t !== o.t || final.lane !== o.lane) edits.push(final);
      }
      if (edits.length) { this.chart.modifyNotes(edits); this.onEdit(); }
      return;
    }
    if (d.kind === "resize") {
      const n = d.note;
      const finalD = n.d;
      n.d = d.orig.d;
      if (Math.abs(finalD - d.orig.d) > 1e-6) {
        this.chart.modifyNotes([{ note: n, d: finalD }]);
        this.onEdit();
      }
      return;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const { x } = this._localPos(e);
    if (e.ctrlKey) {
      const tAtCursor = this.xToTime(x);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      this.view.pps = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.pps * factor));
      this.view.start = Math.max(0, tAtCursor - x / this.view.pps);
    } else {
      const delta = (e.deltaY || e.deltaX) / this.view.pps;
      this.view.start = Math.max(0, this.view.start + delta * 0.8);
    }
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.chart.removeNotes([...this.selection]);
    this.selection.clear();
    this.onEdit();
  }

  // --- rendering ---
  render(playTime) {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const laneH = h / LANES;
    // Lane backgrounds
    for (let l = 0; l < LANES; l++) {
      ctx.fillStyle = l % 2 ? "#181524" : "#1c1930";
      ctx.fillRect(0, l * laneH, w, laneH);
    }

    this._drawGrid(ctx, w, h);

    // Notes
    const noteH = laneH * NOTE_H_FRAC;
    for (const n of this.chart.notes) {
      const x = this.timeToX(n.t);
      const endX = n.type === "hold" ? this.timeToX(n.t + n.d) : x;
      if (endX < -NOTE_W || x > w + NOTE_W) continue;
      const cy = this.laneToY(n.lane);
      const selected = this.selection.has(n);
      ctx.fillStyle = LANE_COLORS[n.lane];
      if (n.type === "hold") {
        roundRect(ctx, x - NOTE_W / 2, cy - noteH / 2, Math.max(NOTE_W, endX - x + NOTE_W / 2), noteH, noteH / 3);
        ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
        // head
        roundRect(ctx, x - NOTE_W / 2, cy - noteH / 2, NOTE_W, noteH, 3);
        ctx.fill();
        // tail edge
        ctx.fillRect(endX - 2, cy - noteH / 2, 3, noteH);
      } else {
        roundRect(ctx, x - NOTE_W / 2, cy - noteH / 2, NOTE_W, noteH, 3);
        ctx.fill();
      }
      if (selected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - NOTE_W / 2 - 2, cy - noteH / 2 - 2, Math.max(NOTE_W, endX - x + NOTE_W / 2) + 4, noteH + 4);
      }
    }

    // Hold-creation preview
    const d = this.drag;
    if (d && d.kind === "add-hold" && d.holdEnd !== undefined) {
      const x0 = this.timeToX(d.t), x1 = this.timeToX(d.holdEnd);
      const cy = this.laneToY(d.lane);
      ctx.fillStyle = LANE_COLORS[d.lane];
      ctx.globalAlpha = 0.5;
      roundRect(ctx, x0 - NOTE_W / 2, cy - noteH / 2, Math.max(NOTE_W, x1 - x0 + NOTE_W / 2), noteH, noteH / 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Marquee
    if (d && d.kind === "marquee") {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      const rx = Math.min(d.x0, d.x1), ry = Math.min(d.y0, d.y1);
      const rw = Math.abs(d.x1 - d.x0), rh = Math.abs(d.y1 - d.y0);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // Lane labels
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let l = 0; l < LANES; l++) {
      ctx.fillStyle = LANE_COLORS[l];
      ctx.globalAlpha = 0.9;
      ctx.fillText(LANE_KEYS[l], 8, (l + 0.5) * laneH);
      ctx.globalAlpha = 1;
    }

    // Playhead
    const px = this.timeToX(playTime);
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  _drawGrid(ctx, w, h) {
    const { bpm, offset } = this.chart;
    if (!(bpm > 0)) return;
    const beatSec = 60 / bpm;
    const div = Math.max(1, this.snapDivision);
    const stepSec = beatSec / div;
    const stepPx = stepSec * this.view.pps;
    if (stepPx < 3) return; // too dense to draw subdivisions — draw beats only
    const t0 = this.view.start, t1 = this.view.start + w / this.view.pps;
    let k = Math.floor((t0 - offset) / stepSec) - 1;
    ctx.lineWidth = 1;
    for (;; k++) {
      const t = offset + k * stepSec;
      if (t > t1) break;
      if (t < t0) continue;
      const x = this.timeToX(t);
      const sub = ((k % div) + div) % div;
      const beatIdx = Math.round((k - sub) / div);
      if (sub === 0 && ((beatIdx % 4) + 4) % 4 === 0) ctx.strokeStyle = "rgba(255,255,255,0.45)"; // bar
      else if (sub === 0) ctx.strokeStyle = "rgba(255,255,255,0.22)"; // beat
      else ctx.strokeStyle = "rgba(255,255,255,0.08)"; // subdivision
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
