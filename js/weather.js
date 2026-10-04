/* Testable weather presets: rain, fog, wet pavement and their visual/physics state. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';

const PRESETS = {
  clear: { rain: 0, fog: 0, wet: 0 },
  rain:  { rain: 1, fog: 0.14, wet: 1 },
  fog:   { rain: 0, fog: 1, wet: 0 },
  wet:   { rain: 0, fog: 0, wet: 1 },
};

const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothToward = (value, target, dt, rate) =>
  value + (target - value) * (1 - Math.exp(-dt * rate));

const WHITE = new THREE.Color(0xffffff);
const WET_ROAD_TINT = new THREE.Color(0xa0aab1);
const WET_SIDEWALK_TINT = new THREE.Color(0xb5bbb8);
const DRY_SPECULAR = new THREE.Color(0x101419);
const WET_ROAD_SPECULAR = new THREE.Color(0x9ab8c8);
const WET_SIDEWALK_SPECULAR = new THREE.Color(0x71858e);

export class WeatherSystem {
  constructor() {
    this.mode = 'clear';
    this.rain = 0;
    this.fog = 0;
    this.wet = 0;
    this.targetRain = 0;
    this.targetFog = 0;
    this.targetWet = 0;

    this.rainCount = 850;
    this.rainRadius = 42;
    this.rainLength = 0.8;
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(this.rainCount * 2 * 3);
    this.rainAttribute = new THREE.BufferAttribute(this.rainPositions, 3);
    this.rainAttribute.setUsage(THREE.DynamicDrawUsage);
    this.rainGeometry.setAttribute('position', this.rainAttribute);

    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0xc4dbea,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.rainMesh = new THREE.LineSegments(
      this.rainGeometry,
      this.rainMaterial
    );
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);

    this.rainDrops = Array.from(
      { length: this.rainCount },
      () => ({ x: 0, y: 0, z: 0, speed: 0 })
    );

    for (const drop of this.rainDrops) {
      this._resetDrop(drop, true);
    }

    this._updateSurfaceMaterials();
  }

  setMode(mode) {
    const preset = PRESETS[mode];
    if (!preset) return false;

    this.mode = mode;
    this.targetRain = preset.rain;
    this.targetFog = preset.fog;
    this.targetWet = preset.wet;
    return true;
  }

  get visibilityFog() {
    return clamp01(Math.max(this.fog, this.rain * 0.12));
  }

  get skyTint() {
    return clamp01(this.fog * 0.62 + this.rain * 0.11) * 0.72;
  }

  get lightDimming() {
    return this.rain * 0.16 + this.fog * 0.08;
  }

  update(dt, playerX = 0, playerZ = 0) {
    dt = Math.max(0, dt || 0);

    this.rain = smoothToward(this.rain, this.targetRain, dt, 2.6);
    this.fog = smoothToward(this.fog, this.targetFog, dt, 1.15);

    // Pavement gets wet quickly and dries gradually after rain stops.
    const wetRate = this.targetWet > this.wet ? 0.75 : 0.075;
    this.wet = smoothToward(this.wet, this.targetWet, dt, wetRate);

    this._updateSurfaceMaterials();
    this._updateRain(dt, playerX, playerZ);
  }

  _resetDrop(drop, initial = false) {
    drop.x = (Math.random() * 2 - 1) * this.rainRadius;
    drop.y = initial
      ? 2 + Math.random() * 29
      : 22 + Math.random() * 18;
    drop.z = (Math.random() * 2 - 1) * this.rainRadius;
    drop.speed = 20 + Math.random() * 16;
  }

  _updateRain(dt, playerX, playerZ) {
    this.rainMesh.position.set(playerX, 0, playerZ);
    this.rainMesh.visible = this.rain > 0.01;
    this.rainMaterial.opacity = this.rain * 0.38;

    if (!this.rainMesh.visible) return;

    const windX = 1.8 * this.rain;
    const windZ = 0.65 * this.rain;

    for (let i = 0; i < this.rainCount; i++) {
      const drop = this.rainDrops[i];

      drop.y -= drop.speed * dt;
      drop.x += windX * dt;
      drop.z += windZ * dt;

      if (
        drop.y < -1 ||
        Math.abs(drop.x) > this.rainRadius ||
        Math.abs(drop.z) > this.rainRadius
      ) {
        this._resetDrop(drop);
      }

      const j = i * 6;
      this.rainPositions[j] = drop.x;
      this.rainPositions[j + 1] = drop.y;
      this.rainPositions[j + 2] = drop.z;
      this.rainPositions[j + 3] = drop.x + windX * 0.035;
      this.rainPositions[j + 4] = drop.y - this.rainLength;
      this.rainPositions[j + 5] = drop.z + windZ * 0.035;
    }

    this.rainAttribute.needsUpdate = true;
  }

  _tintMaterial(material, wet, isRoad) {
    material.color
      .copy(WHITE)
      .lerp(isRoad ? WET_ROAD_TINT : WET_SIDEWALK_TINT, wet);

    if (material.specular) {
      material.specular
        .copy(DRY_SPECULAR)
        .lerp(
          isRoad ? WET_ROAD_SPECULAR : WET_SIDEWALK_SPECULAR,
          wet
        );

      material.shininess =
        (isRoad ? 5 : 3) + wet * (isRoad ? 72 : 42);
    }
  }

  _updateSurfaceMaterials() {
    this._tintMaterial(ASSET.roadMat, this.wet, true);

    for (const material of ASSET.sidewalkMats) {
      this._tintMaterial(material, this.wet, false);
    }
  }

  mountTestControls(onToast = () => {}) {
    const existing = document.getElementById('weatherTestPanel');
    if (existing) return existing;

    if (!document.getElementById('weatherTestStyles')) {
      const style = document.createElement('style');
      style.id = 'weatherTestStyles';
      style.textContent = `
        #weatherTestPanel {
          position: fixed;
          bottom: 12px;
          left: 12px;
          z-index: 99999;
          width: 224px;
          box-sizing: border-box;
          padding: 10px;
          color: #eef5fb;
          background: rgba(8, 15, 24, .9);
          border: 1px solid rgba(180, 210, 230, .35);
          border-radius: 12px;
          box-shadow: 0 8px 26px rgba(0,0,0,.35);
          backdrop-filter: blur(8px);
          font: 12px/1.35 system-ui, sans-serif;
        }
        #weatherTestPanel * { box-sizing: border-box; }
        #weatherTestPanel .weatherTestHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-weight: 800;
          letter-spacing: .08em;
        }
        #weatherTestPanel .weatherTestToggle {
          width: 26px;
          height: 24px;
          padding: 0;
          border: 1px solid rgba(255,255,255,.22);
          border-radius: 7px;
          color: #fff;
          background: rgba(255,255,255,.08);
          font: inherit;
          cursor: pointer;
        }
        #weatherTestPanel .weatherTestStatus {
          margin: 7px 0;
          color: #a9c2d5;
          font-size: 10px;
          letter-spacing: .08em;
        }
        #weatherTestPanel .weatherTestButtons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        #weatherTestPanel .weatherTestButton {
          min-height: 32px;
          padding: 5px 7px;
          border: 1px solid rgba(255,255,255,.18);
          border-radius: 8px;
          color: #e9f0f5;
          background: rgba(255,255,255,.07);
          font: 600 11px/1.2 system-ui, sans-serif;
          cursor: pointer;
          touch-action: manipulation;
        }
        #weatherTestPanel .weatherTestButton:hover {
          background: rgba(255,255,255,.16);
        }
        #weatherTestPanel .weatherTestButton.active {
          color: #fff;
          border-color: #69d6c0;
          background: rgba(35,142,119,.62);
        }
        @media (max-width: 520px) {
          #weatherTestPanel {
            bottom: 154px;
            left: 8px;
            width: 204px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const panel = document.createElement('aside');
    panel.id = 'weatherTestPanel';
    panel.setAttribute('aria-label', 'Weather testing controls');

    const head = document.createElement('div');
    head.className = 'weatherTestHead';

    const title = document.createElement('span');
    title.textContent = 'WEATHER TEST';

    const toggle = document.createElement('button');
    toggle.className = 'weatherTestToggle';
    toggle.type = 'button';
    toggle.textContent = '−';
    toggle.setAttribute('aria-label', 'Collapse weather controls');
    toggle.setAttribute('aria-expanded', 'true');
    head.append(title, toggle);

    const body = document.createElement('div');

    const status = document.createElement('div');
    status.className = 'weatherTestStatus';

    const buttons = document.createElement('div');
    buttons.className = 'weatherTestButtons';
    body.append(status, buttons);

    const options = [
      { id: 'clear', label: '☀ Clear' },
      { id: 'rain', label: '🌧 Rain' },
      { id: 'fog', label: '🌫 Fog' },
      { id: 'wet', label: '💧 Wet road' },
    ];

    const buttonNodes = new Map();

    const syncControls = () => {
      status.textContent = 'SELECTED: ' + this.mode.toUpperCase();

      for (const [id, button] of buttonNodes) {
        const active = id === this.mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    };

    for (const option of options) {
      const button = document.createElement('button');
      button.className = 'weatherTestButton';
      button.type = 'button';
      button.textContent = option.label;

      button.addEventListener('click', () => {
        this.setMode(option.id);
        syncControls();
        onToast('WEATHER: ' + option.id.toUpperCase());
      });

      buttons.appendChild(button);
      buttonNodes.set(option.id, button);
    }

    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '+' : '−';
      toggle.setAttribute('aria-expanded', String(!body.hidden));
      toggle.setAttribute(
        'aria-label',
        body.hidden ? 'Expand weather controls' : 'Collapse weather controls'
      );
    });

    panel.append(head, body);
    document.body.appendChild(panel);
    syncControls();
    return panel;
  }
}

export const weatherSystem = new WeatherSystem();
