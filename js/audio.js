/* Procedural WebAudio */
import { clamp } from './utils.js';
export const sfx = {
  ctx: null, last: 0, muted: false,
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(c.destination);
      this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
      this.engGain = c.createGain(); this.engGain.gain.value = 0; this.eng.connect(lp); lp.connect(this.engGain); this.engGain.connect(this.master); this.eng.start();
      this.sir = c.createOscillator(); this.sir.type = 'square'; this.sirGain = c.createGain(); this.sirGain.gain.value = 0; this.sir.connect(this.sirGain); this.sirGain.connect(this.master); this.sir.start();
      // --- helicopter: filtered broadband noise + amplitude "blade-slap" chop + quiet low engine hum ---
      // (a real helicopter is NOT a pure tone — it's turbine/wind noise punched by periodic rotor thumps)
      const hl = Math.floor(c.sampleRate), hb = c.createBuffer(1, hl, c.sampleRate), hd = hb.getChannelData(0);
      for (let i = 0; i < hl; i++) hd[i] = Math.random() * 2 - 1;
      this.heliSrc = c.createBufferSource(); this.heliSrc.buffer = hb; this.heliSrc.loop = true;
      const hlp = c.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 300; hlp.Q.value = 1.3;
      this.heliChop = c.createGain(); this.heliChop.gain.value = 0;   // per-frame blade-pass envelope (NOT smoothed → keeps the "wokka" crisp)
      this.heliGain = c.createGain(); this.heliGain.gain.value = 0;   // distance-based overall volume (smoothed)
      this.heliSrc.connect(hlp); hlp.connect(this.heliChop); this.heliChop.connect(this.heliGain); this.heliGain.connect(this.master); this.heliSrc.start();
      this.heliHum = c.createOscillator(); this.heliHum.type = 'sawtooth'; this.heliHum.frequency.value = 72;
      const hhlp = c.createBiquadFilter(); hhlp.type = 'lowpass'; hhlp.frequency.value = 160;
      this.heliHumGain = c.createGain(); this.heliHumGain.gain.value = 0;
      this.heliHum.connect(hhlp); hhlp.connect(this.heliHumGain); this.heliHumGain.connect(this.master); this.heliHum.start();
      const len = Math.floor(c.sampleRate * 0.4); this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      // nitro whoosh: looping band-passed noise
      const nl = Math.floor(c.sampleRate), nb = c.createBuffer(1, nl, c.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
      this.nsrc = c.createBufferSource(); this.nsrc.buffer = nb; this.nsrc.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
      this.nGain = c.createGain(); this.nGain.gain.value = 0; this.nsrc.connect(bp); bp.connect(this.nGain); this.nGain.connect(this.master); this.nsrc.start();
    } catch (e) { this.ctx = null; }
  },
  update(speed, nearest, active, t, boost = 0) {
    if (!this.ctx) return; const c = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(48 + speed * 3.4 + boost * 30, c, 0.06); this.engGain.gain.setTargetAtTime(active ? 0.05 : 0, c, 0.1);
    this.sirGain.gain.setTargetAtTime(active ? clamp(1 - nearest / 130, 0, 1) * 0.03 : 0, c, 0.1);
    this.sir.frequency.setTargetAtTime(760 + Math.sin(t * 5.5) * 230, c, 0.03);
    this.nGain.gain.setTargetAtTime(active ? boost * 0.14 : 0, c, 0.08);
  },
  // helicopter proximity: louder the closer it is, with a real blade-slap pulse synced to the 3D rotor angle
  // (rotorAngle = helicopter.rotor.rotation.y — the cross-shaped rotor repeats every 90°, i.e. 4 "thumps"/revolution)
  updateHeli(dist, active, rotorAngle) {
    if (!this.ctx) return; const c = this.ctx.currentTime;
    const vol = active ? clamp(1 - dist / 140, 0, 1) : 0;
    this.heliGain.gain.setTargetAtTime(vol * 0.16, c, 0.15);           // overall loudness — kept subtle
    this.heliHumGain.gain.setTargetAtTime(vol * 0.045, c, 0.15);       // quiet mechanical body under the chop
    const chop = 0.2 + 0.8 * Math.pow(Math.abs(Math.sin(rotorAngle * 2)), 2);
    this.heliChop.gain.setValueAtTime(active ? chop : 0, c);           // set directly — already smooth, no need to ramp
  },
  crash(power) {
    if (!this.ctx) return; const now = this.ctx.currentTime; if (now - this.last < 0.07) return; this.last = now;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; const g = this.ctx.createGain(); g.gain.value = clamp(power / 35, 0.12, 0.9);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + power * 25; s.connect(f); f.connect(g); g.connect(this.master); s.start();
  },
  blip(freq) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15); o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + 0.16);
  },
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.6; }
};