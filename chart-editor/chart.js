// Chart data model: notes, undo/redo command stack, serialization + validation.
// Beatmap format (engineering spec):
// {
//   "version": 1,
//   "song": { "title", "artist", "audioFile", "duration" },
//   "bpm": 128.0, "offset": 0.412, "lanes": 4,
//   "notes": [ { "t", "lane", "type": "tap" }, { "t", "lane", "type": "hold", "d" } ]
// }

export const LANES = 4;
const UNDO_CAP = 200;

const round3 = (x) => Math.round(x * 1000) / 1000;

export class Chart {
  constructor() {
    this.song = { title: "", artist: "", audioFile: "", duration: 0 };
    this.bpm = 120;
    this.offset = 0;
    this.notes = []; // { t, lane, type, d? } — live objects, kept sorted by t
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = () => {};
  }

  sort() { this.notes.sort((a, b) => a.t - b.t || a.lane - b.lane); }

  // --- Command stack ---
  _push(cmd) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.sort();
    this.onChange();
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.redo();
    this.sort();
    this.onChange();
    return true;
  }

  // --- Edits (each is one undoable command) ---
  addNote(note) {
    const n = { ...note };
    this.notes.push(n);
    this.sort();
    this._push({
      redo: () => { this.notes.push(n); this.sort(); },
      undo: () => { this.notes.splice(this.notes.indexOf(n), 1); },
    });
    return n;
  }

  removeNotes(notes) {
    const list = [...notes];
    if (!list.length) return;
    const doRemove = () => { for (const n of list) { const i = this.notes.indexOf(n); if (i >= 0) this.notes.splice(i, 1); } };
    doRemove();
    this._push({
      redo: doRemove,
      undo: () => { this.notes.push(...list); this.sort(); },
    });
  }

  // edits: [{ note, t?, lane?, d?, type? }] — one command for the whole batch
  modifyNotes(edits) {
    if (!edits.length) return;
    const before = edits.map(({ note }) => ({ note, t: note.t, lane: note.lane, type: note.type, d: note.d }));
    const after = edits.map((e) => ({ note: e.note, t: e.t ?? e.note.t, lane: e.lane ?? e.note.lane, type: e.type ?? e.note.type, d: e.d !== undefined ? e.d : e.note.d }));
    const apply = (list) => {
      for (const s of list) {
        s.note.t = s.t; s.note.lane = s.lane; s.note.type = s.type;
        if (s.type === "hold") s.note.d = s.d; else delete s.note.d;
      }
      this.sort();
    };
    apply(after);
    this._push({ redo: () => apply(after), undo: () => apply(before) });
  }

  // Replace all notes (used by auto-generation) as one undoable op
  replaceAllNotes(newNotes) {
    const old = [...this.notes];
    const next = newNotes.map((n) => ({ ...n }));
    this.notes = [...next];
    this.sort();
    this._push({
      redo: () => { this.notes = [...next]; this.sort(); },
      undo: () => { this.notes = [...old]; },
    });
  }

  setBpmOffset(bpm, offset) {
    const prev = { bpm: this.bpm, offset: this.offset };
    const next = { bpm, offset };
    this.bpm = bpm;
    this.offset = offset;
    this._push({
      redo: () => { this.bpm = next.bpm; this.offset = next.offset; },
      undo: () => { this.bpm = prev.bpm; this.offset = prev.offset; },
    });
  }

  // --- Beat/time helpers (grid) ---
  timeToBeat(t) { return ((t - this.offset) * this.bpm) / 60; }
  beatToTime(b) { return this.offset + (b * 60) / this.bpm; }
  snapTime(t, division) {
    if (!(this.bpm > 0) || !(division > 0)) return t;
    const b = this.timeToBeat(t);
    return this.beatToTime(Math.round(b * division) / division);
  }

  // --- Serialization ---
  serialize() {
    this.sort();
    return {
      version: 1,
      song: {
        title: this.song.title,
        artist: this.song.artist,
        audioFile: this.song.audioFile,
        duration: round3(this.song.duration),
      },
      bpm: this.bpm,
      offset: round3(this.offset),
      lanes: LANES,
      notes: this.notes.map((n) =>
        n.type === "hold"
          ? { t: round3(n.t), lane: n.lane, type: "hold", d: round3(n.d) }
          : { t: round3(n.t), lane: n.lane, type: "tap" }
      ),
    };
  }

  // Throws with a readable message on invalid input.
  loadSerialized(data) {
    if (!data || typeof data !== "object") throw new Error("Not a JSON object");
    if (data.version !== 1) throw new Error(`Unsupported version: ${data.version}`);
    if (data.lanes !== LANES) throw new Error(`Expected ${LANES} lanes, got ${data.lanes}`);
    if (!Array.isArray(data.notes)) throw new Error("Missing notes array");
    const notes = data.notes.map((n, i) => {
      if (typeof n.t !== "number" || n.t < 0) throw new Error(`Note ${i}: bad time`);
      if (!Number.isInteger(n.lane) || n.lane < 0 || n.lane >= LANES) throw new Error(`Note ${i}: bad lane`);
      if (n.type === "hold") {
        if (typeof n.d !== "number" || n.d <= 0) throw new Error(`Note ${i}: hold needs d > 0`);
        return { t: n.t, lane: n.lane, type: "hold", d: n.d };
      }
      if (n.type !== "tap") throw new Error(`Note ${i}: unknown type "${n.type}"`);
      return { t: n.t, lane: n.lane, type: "tap" };
    });
    this.song = {
      title: data.song?.title ?? "",
      artist: data.song?.artist ?? "",
      audioFile: data.song?.audioFile ?? "",
      duration: data.song?.duration ?? 0,
    };
    this.bpm = typeof data.bpm === "number" && data.bpm > 0 ? data.bpm : 120;
    this.offset = typeof data.offset === "number" ? data.offset : 0;
    this.notes = notes;
    this.sort();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange();
  }
}
