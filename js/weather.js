/* Selectable weather, precipitation visuals, road response, and storm lightning. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { sfx } from './audio.js';
import { clamp } from './utils.js';

export const WEATHER_MODES = Object.freeze({
  sunny: {
    label: 'SUNNY', icon: '☀', rain: 0, snow: 0, wet: 0, snowCover: 0,
    clouds: 0, fog: 0,
  },
  rain: {
    label: 'RAINY', icon: '🌧', rain: 0.62, snow: 0, wet: 0.72, snowCover: 0,
    clouds: 0.32, fog: 0.12,
  },
  snow: {
    label: 'SNOWY', icon: '❄', rain: 0, snow: 1, wet: 0.08, snowCover: 0.76,
    clouds: 0.4, fog: 0.16,
  },
  storm: {
    label: 'THUNDERSTORM', icon: '⛈', rain: 1, snow: 0, wet: 1, snowCover: 0,
    clouds: 0.82, fog: 0.42,
  },
});

const clamp01 = value => clamp(value, 0, 1);
const approach = (value, target, dt, rate) =>
  value + (target - value) * (1 - Math.exp(-dt * rate));
const WHITE = new THREE.Color(0xffffff);
const RAIN_TINT = new THREE.Color(0x9baab4);
const SNOW_TINT = new THREE.Color(0xe0e9ef);
const DRY_SPECULAR = new THREE.Color(0x101419);
const WET_SPECULAR = new THREE.Color(0x9ab8c8);

export class WeatherSystem {
  constructor() {
    this.mode = 'sunny';
    try {
      const saved = localStorage.getItem('escape_road_weather');
      if (WEATHER_MODES[saved]) this.mode = saved;
    } catch (_) {}

    this.rain = 0;
    this.snow = 0;
    this.wet = 0;
    this.snowCover = 0;
    this.clouds = 0;
    this.fog = 0;
    this.lightningFlash = 0;
    this.thunderTimer = 9 + Math.random() * 8;
    this.thunderDelay = -1;
    this.thunderPending = false;
    this.thunderPower = 1;
    this._lastWet = -1;
    this._lastSnow = -1;
    this._setTargets();

    this.rainRadius = 42;
    this.rainMax = 520;
    this.rainLength = 1.15;
    this.rainPositions = new Float32Array(this.rainMax * 2 * 3);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainAttribute = new THREE.BufferAttribute(this.rainPositions, 3);
    this.rainAttribute.setUsage(THREE.DynamicDrawUsage);
    this.rainGeometry.setAttribute('position', this.rainAttribute);
    this.rainGeometry.setDrawRange(0, 0);
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0xc4dbea, transparent: true, opacity: 0,
      depthWrite: false,
    });
    this.rainMesh = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);
    this.rainDrops = Array.from({ length: this.rainMax }, () => ({ x: 0, y: 0, z: 0, speed: 0 }));
    for (const drop of this.rainDrops) this._resetRain(drop, true);

    this.snowRadius = 38;
    this.snowMax = 190;
    this.snowPositions = new Float32Array(this.snowMax * 3);
    this.snowGeometry = new THREE.BufferGeometry();
    this.snowAttribute = new THREE.BufferAttribute(this.snowPositions, 3);
    this.snowAttribute.setUsage(THREE.DynamicDrawUsage);
    this.snowGeometry.setAttribute('position', this.snowAttribute);
    this.snowGeometry.setDrawRange(0, 0);
    const snowCanvas = document.createElement('canvas');
    snowCanvas.width = snowCanvas.height = 32;
    const snowCtx = snowCanvas.getContext('2d');
    const gradient = snowCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.48, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    snowCtx.fillStyle = gradient;
    snowCtx.fillRect(0, 0, 32, 32);
    this.snowTexture = new THREE.CanvasTexture(snowCanvas);
    this.snowTexture.colorSpace = THREE.SRGBColorSpace;
    this.snowMaterial = new THREE.PointsMaterial({
      color: 0xf2f8ff, map: this.snowTexture, size: 0.25,
      transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
    });
    this.snowMesh = new THREE.Points(this.snowGeometry, this.snowMaterial);
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    scene.add(this.snowMesh);
    this.snowflakes = Array.from({ length: this.snowMax }, () => ({ x: 0, y: 0, z: 0, speed: 0 }));
    for (const flake of this.snowflakes) this._resetSnow(flake, true);

    this.lightningElement = document.getElementById('lightning');
  }

  get label() {
    return WEATHER_MODES[this.mode].label;
  }

  get icon() {
    return WEATHER_MODES[this.mode].icon;
  }

  get slickness() {
    return clamp01(this.wet * 0.68 + this.snowCover * 0.72) * 0.9;
  }

  setMode(mode) {
    if (!WEATHER_MODES[mode]) return false;
    this.mode = mode;
    this._setTargets();
    try { localStorage.setItem('escape_road_weather', mode); } catch (_) {}
    return true;
  }

  _setTargets() {
    const preset = WEATHER_MODES[this.mode];
    this.targetRain = preset.rain;
    this.targetSnow = preset.snow;
    this.targetWet = preset.wet;
    this.targetSnowCover = preset.snowCover;
    this.targetClouds = preset.clouds;
    this.targetFog = preset.fog;
  }

  _resetRain(drop, initial = false) {
    drop.x = (Math.random() * 2 - 1) * this.rainRadius;
    drop.y = initial ? 2 + Math.random() * 30 : 22 + Math.random() * 16;
    drop.z = (Math.random() * 2 - 1) * this.rainRadius;
    drop.speed = 27 + Math.random() * 15;
  }

  _resetSnow(flake, initial = false) {
    flake.x = (Math.random() * 2 - 1) * this.snowRadius;
    flake.y = initial ? 2 + Math.random() * 25 : 20 + Math.random() * 12;
    flake.z = (Math.random() * 2 - 1) * this.snowRadius;
    flake.speed = 1.8 + Math.random() * 2.6;
  }

  update(dt, playerX = 0, playerZ = 0, audioEnabled = false) {
    dt = Math.max(0, dt || 0);
    this.rain = approach(this.rain, this.targetRain, dt, 2.2);
    this.snow = approach(this.snow, this.targetSnow, dt, 1.25);
    this.wet = approach(this.wet, this.targetWet, dt, this.targetWet > this.wet ? 0.72 : 0.085);
    this.snowCover = approach(this.snowCover, this.targetSnowCover, dt, this.targetSnowCover > this.snowCover ? 0.28 : 0.12);
    this.clouds = approach(this.clouds, this.targetClouds, dt, 0.8);
    this.fog = approach(this.fog, this.targetFog, dt, 0.7);

    if (Math.abs(this.wet - this._lastWet) > 0.003 || Math.abs(this.snowCover - this._lastSnow) > 0.003) {
      this._updateRoadSurface();
    }
    this._updateRain(dt, playerX, playerZ);
    this._updateSnow(dt, playerX, playerZ);
    this._updateLightning(dt, audioEnabled);
  }

  _updateRoadSurface() {
    this._lastWet = this.wet;
    this._lastSnow = this.snowCover;
    if (ASSET.roadMat) {
      ASSET.roadMat.color.copy(WHITE)
        .lerp(RAIN_TINT, this.wet * 0.2)
        .lerp(SNOW_TINT, this.snowCover * 0.3);
      if (ASSET.roadMat.specular) {
        ASSET.roadMat.specular.copy(DRY_SPECULAR).lerp(WET_SPECULAR, this.wet);
        ASSET.roadMat.shininess = 5 + this.wet * 68;
      }
    }
    if (ASSET.snowRoadMat) ASSET.snowRoadMat.opacity = this.snowCover * 0.48;
  }

  _updateRain(dt, playerX, playerZ) {
    const count = Math.round(this.rainMax * this.rain);
    this.rainMesh.visible = count > 0;
    this.rainMesh.position.set(playerX, 0, playerZ);
    this.rainMaterial.opacity = this.rain * 0.48;
    this.rainGeometry.setDrawRange(0, count * 2);
    if (!count) return;

    const windX = this.rain * (this.mode === 'storm' ? 3.8 : 1.2);
    const windZ = this.rain * (this.mode === 'storm' ? 1.4 : 0.35);
    for (let i = 0; i < count; i++) {
      const drop = this.rainDrops[i];
      drop.y -= drop.speed * (this.mode === 'storm' ? 1.25 : 1) * dt;
      drop.x += windX * dt;
      drop.z += windZ * dt;
      if (drop.y < -1 || Math.abs(drop.x) > this.rainRadius || Math.abs(drop.z) > this.rainRadius) {
        this._resetRain(drop);
      }
      const j = i * 6;
      this.rainPositions[j] = drop.x;
      this.rainPositions[j + 1] = drop.y;
      this.rainPositions[j + 2] = drop.z;
      this.rainPositions[j + 3] = drop.x + windX * 0.035;
      this.rainPositions[j + 4] = drop.y - this.rainLength * (this.mode === 'storm' ? 1.35 : 1);
      this.rainPositions[j + 5] = drop.z + windZ * 0.035;
    }
    this.rainAttribute.needsUpdate = true;
  }

  _updateSnow(dt, playerX, playerZ) {
    const count = Math.round(this.snowMax * this.snow);
    this.snowMesh.visible = count > 0;
    this.snowMesh.position.set(playerX, 0, playerZ);
    this.snowMaterial.opacity = this.snow * 0.9;
    this.snowGeometry.setDrawRange(0, count);
    if (!count) return;

    const windX = 0.16 * this.snow + Math.sin(performance.now() * 0.00035) * 0.06;
    const windZ = 0.06 * this.snow + Math.cos(performance.now() * 0.00028) * 0.04;
    for (let i = 0; i < count; i++) {
      const flake = this.snowflakes[i];
      flake.y -= flake.speed * dt;
      flake.x += windX * dt;
      flake.z += windZ * dt;
      if (flake.y < -0.5 || Math.abs(flake.x) > this.snowRadius || Math.abs(flake.z) > this.snowRadius) {
        this._resetSnow(flake);
      }
      const j = i * 3;
      this.snowPositions[j] = flake.x;
      this.snowPositions[j + 1] = flake.y;
      this.snowPositions[j + 2] = flake.z;
    }
    this.snowAttribute.needsUpdate = true;
  }

  _updateLightning(dt, audioEnabled) {
    if (this.mode === 'storm') {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.lightningFlash = 1;
        this.thunderDelay = 0.25 + Math.random() * 0.45;
        this.thunderPending = true;
        this.thunderPower = 0.7 + Math.random() * 0.55;
        this.thunderTimer = 8 + Math.random() * 12;
      }
      if (this.thunderPending) {
        this.thunderDelay -= dt;
        if (this.thunderDelay <= 0) {
          if (audioEnabled) sfx.thunder(this.thunderPower);
          this.thunderPending = false;
        }
      }
    } else {
      this.thunderPending = false;
    }

    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 5.8);
    if (this.lightningElement) this.lightningElement.style.opacity = String(this.lightningFlash);
  }
}

export const weatherSystem = new WeatherSystem();