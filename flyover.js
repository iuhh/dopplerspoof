'use strict';

const sampleRate = 48000;
const soundSpeed = 343;
const tau = 2 * Math.PI;
const radians = Math.PI / 180;
const propOrders = [0.68, 0.31, 0.19, 0.12, 0.08, 0.05, 0.032, 0.023];
const aircraftPresets = {
  c152: { name: 'Cessna 152', knots: 90, rpm: 2350, maxRpm: 2550, colour: 1, exhaust: 1 },
  pa28: { name: 'Piper PA-28 Archer', knots: 105, rpm: 2420, maxRpm: 2700, colour: 0.8, exhaust: 1.4 },
  c172: { name: 'Cessna 172 Skyhawk', knots: 105, rpm: 2400, maxRpm: 2700, colour: 0.9, exhaust: 1.2 },
  dr400: { name: 'Robin DR400', knots: 100, rpm: 2400, maxRpm: 2700, colour: 1.2, exhaust: 1.1 },
};
const countryAircraft = { uk: 'c152', us: 'c172', fr: 'dr400' };

// The negative root ensures emission is always earlier than arrival.
function emissionTime(arrival, speed, closestRange) {
  const beta = speed / soundSpeed;
  const factor = 1 - beta * beta;
  return (arrival - Math.hypot(beta * arrival, Math.sqrt(factor) * closestRange / soundSpeed)) / factor;
}

function renderFlyover({ knots, feet, track, facing, offset, rpm, channels, aircraft = 'c152', voice = 0 }) {
  const preset = aircraftPresets[aircraft];
  const speed = knots * 1852 / 3600;
  const height = feet * 0.3048;
  const closestRange = Math.hypot(height, offset);
  const delay = closestRange / soundSpeed;
  const half = Math.min(34, Math.max(12, 2.7 * closestRange / speed));
  const frames = Math.ceil(2 * half * sampleRate);
  const firstArrival = delay - half;
  const firstEmission = emissionTime(firstArrival, speed, closestRange);
  const lastEmission = emissionTime(firstArrival + frames / sampleRate, speed, closestRange);
  const sourceNoise = new Float32Array(Math.ceil((lastEmission - firstEmission) * sampleRate) + 2);
  let seed = (0x693ca128 + voice * 7919) >>> 0;
  let rumble = 0;
  let air = 0;
  for (let i = 0; i < sourceNoise.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1;
    rumble += 0.018 * (white - rumble);
    air += 0.22 * (white - air);
    sourceNoise[i] = 1.9 * rumble + 0.6 * (air - rumble);
  }

  const pcm = Array.from({ length: channels }, () => new Float32Array(frames));
  const bearing = (track - facing) * radians;
  const travelRight = Math.sin(bearing);
  const offsetRight = Math.cos(bearing);
  const bladeFrequency = 2 * rpm / 60;
  let filteredNoise = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const emitted = emissionTime(firstArrival + t, speed, closestRange);
    const along = speed * emitted;
    const range = Math.hypot(along, closestRange);
    const nose = -along / range;
    const broadside = Math.sqrt(1 - nose * nose);
    const phase = tau * bladeFrequency * emitted + voice * 1.7 + 0.22 * Math.sin(tau * 0.67 * emitted);
    let prop = 0;
    for (let order = 0; order < propOrders.length; order++) {
      const brightness = 1 / (1 + order * range / (10000 * preset.colour));
      prop += propOrders[order] * brightness * Math.sin((order + 1) * phase + order * 0.71);
    }
    const at = (emitted - firstEmission) * sampleRate;
    const lower = Math.floor(at);
    const noise = sourceNoise[lower] + (sourceNoise[lower + 1] - sourceNoise[lower]) * (at - lower);
    filteredNoise += Math.min(0.65, 0.36 / (1 + range / 2200)) * (noise - filteredNoise);
    const exhaust = Math.sin(phase + 1.18) + 0.30 * Math.sin(3 * phase + 0.9) + 0.12 * Math.sin(phase / 2);
    const texture = prop * (0.67 + 0.32 * broadside + 0.14 * nose)
      + exhaust * preset.exhaust * (0.12 - 0.07 * nose) + filteredNoise * (0.57 - 0.16 * nose);
    const fade = Math.min(1, t / 3.5, (frames - 1 - i) / (7 * sampleRate));
    const envelope = (1 - Math.cos(Math.PI * fade)) / 2;
    const sample = Math.tanh(texture * (110 / range) * envelope);
    if (channels === 1) {
      pcm[0][i] = sample;
    } else {
      const pan = (along * travelRight + offset * offsetRight) / range;
      const angle = (pan + 1) * Math.PI / 4;
      pcm[0][i] = sample * Math.cos(angle);
      pcm[1][i] = sample * Math.sin(angle);
    }
  }
  return { pcm, sampleRate, closestRange, delay, bladeFrequency };
}

function renderScene({ planes, facing, channels }) {
  const tracks = planes.map((plane, voice) => {
    const sound = renderFlyover({ ...plane, facing, channels, voice });
    return { sound, start: Math.round(plane.cpa * sampleRate) - Math.floor(sound.pcm[0].length / 2) };
  });
  const first = Math.min(...tracks.map(track => track.start));
  const end = Math.max(...tracks.map(track => track.start + track.sound.pcm[0].length));
  const pcm = Array.from({ length: channels }, () => new Float32Array(end - first));
  for (const { sound, start } of tracks) {
    const offset = start - first;
    sound.pcm.forEach((source, channel) => {
      for (let i = 0; i < source.length; i++) pcm[channel][offset + i] += source[i];
    });
  }
  let peak = 0;
  for (const channel of pcm) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  if (peak > 0.98) {
    for (const channel of pcm) for (let i = 0; i < channel.length; i++) channel[i] *= 0.98 / peak;
  }
  return { pcm, sampleRate };
}

function encodeWav({ pcm, sampleRate }) {
  const channels = pcm.length;
  const size = pcm[0].length * channels * 2;
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const tag = (offset, value) => bytes.set(Array.from(value, char => char.charCodeAt(0)), offset);
  tag(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, size, true);
  let cursor = 44;
  for (let i = 0; i < pcm[0].length; i++) {
    for (const channel of pcm) {
      view.setInt16(cursor, Math.round(channel[i] * 32767), true);
      cursor += 2;
    }
  }
  return bytes;
}

if (typeof module !== 'undefined') module.exports = { renderFlyover, renderScene, encodeWav, emissionTime };

if (typeof document !== 'undefined') {
  const form = document.querySelector('#flyover');
  const preview = document.querySelector('#preview');
  const stop = document.querySelector('#stop');
  const status = document.querySelector('#status');
  const level = document.querySelector('#level');
  const levelValue = document.querySelector('#level-value');
  const aircraftList = document.querySelector('#aircraft');
  const add = document.querySelector('#add-aircraft');
  let prepared;
  let loaded;
  let playRequest = 0;

  function updateLevel() {
    const db = Number(level.value);
    preview.volume = 10 ** (db / 20);
    levelValue.textContent = `${String(db).replace('-', '−')} dB`;
  }
  level.addEventListener('input', updateLevel);
  updateLevel();

  function updateAircraftList() {
    Array.from(aircraftList.children).forEach((row, index) => {
      row.querySelector('legend').textContent = `Aircraft ${index + 1}`;
      row.querySelector('button').disabled = aircraftList.children.length === 1;
    });
    add.disabled = aircraftList.children.length >= 4;
  }

  function applyPreset(row) {
    const preset = aircraftPresets[row.querySelector('[name="aircraft"]').value];
    row.querySelector('[name="knots"]').value = preset.knots;
    const rpm = row.querySelector('[name="rpm"]');
    rpm.max = preset.maxRpm;
    rpm.value = preset.rpm;
  }

  function addAircraft() {
    const index = aircraftList.children.length;
    const row = document.createElement('fieldset');
    row.innerHTML = `<legend></legend><div class="controls">
      <label>Aircraft preset<select name="aircraft">${Object.entries(aircraftPresets).map(([key, preset]) => `<option value="${key}">${preset.name}</option>`).join('')}</select></label>
      <label>Groundspeed (kt)<input name="knots" type="number" min="55" max="130" required></label>
      <label>Height above mic (ft)<input name="feet" type="number" min="100" max="6000" value="1200" required></label>
      <label>Track (° clockwise from north)<input name="track" type="number" min="0" max="359" value="${index % 2 ? 270 : 90}" required></label>
      <label>Offset from mic (m)<input name="offset" type="number" min="0" max="2000" value="150" required></label>
      <label>Offset side<select name="side"><option value="-1">Left of mic</option><option value="1">Right of mic</option></select></label>
      <label>Propeller speed (RPM)<input name="rpm" type="number" min="1900" required></label>
      <label>Closest approach offset (s)<input name="cpa" type="number" min="0" max="120" value="${index * 8}" required></label>
      </div><div class="actions"><button type="button">Remove aircraft</button></div>`;
    const select = row.querySelector('[name="aircraft"]');
    select.value = countryAircraft[form.elements.country.value];
    select.addEventListener('change', () => applyPreset(row));
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      updateAircraftList();
    });
    applyPreset(row);
    aircraftList.append(row);
    updateAircraftList();
  }

  add.addEventListener('click', addAircraft);
  form.elements.country.addEventListener('change', () => {
    const first = aircraftList.firstElementChild;
    first.querySelector('[name="aircraft"]').value = countryAircraft[form.elements.country.value];
    applyPreset(first);
  });
  addAircraft();

  function prepare() {
    const planes = Array.from(aircraftList.children, row => {
      const fields = Object.fromEntries(Array.from(row.querySelectorAll('[name]'), element => [element.name, element.name === 'aircraft' ? element.value : Number(element.value)]));
      fields.offset *= fields.side;
      return fields;
    });
    const fields = { planes, facing: Number(form.elements.facing.value), channels: Number(form.elements.channels.value) };
    const key = JSON.stringify(fields);
    if (prepared?.key === key) return prepared;
    const sound = renderScene(fields);
    const blob = new Blob([encodeWav(sound)], { type: 'audio/wav' });
    const description = `${(sound.pcm[0].length / sampleRate).toFixed(1)} s · ${planes.length} aircraft · nominal blade-pass tones ${planes.map(plane => (2 * plane.rpm / 60).toFixed(1)).join(', ')} Hz`;
    prepared = { key, blob, description };
    return prepared;
  }
  window.generatedFlyover = () => form.reportValidity() ? prepare().blob : null;

  async function playPass() {
    const request = ++playRequest;
    try {
      const sound = prepare();
      if (loaded?.sound !== sound) {
        const url = URL.createObjectURL(sound.blob);
        preview.src = url;
        if (loaded) URL.revokeObjectURL(loaded.url);
        loaded = { sound, url };
      }
      preview.hidden = false;
      preview.currentTime = 0;
      await preview.play();
      if (request === playRequest) status.textContent = sound.description;
    } catch (error) {
      if (request === playRequest) {
        status.textContent = `Playback failed. ${error.message}`;
      }
    }
  }

  function stopPlayback() {
    playRequest++;
    preview.pause();
    if (loaded) preview.currentTime = 0;
    stop.disabled = true;
    status.textContent = 'Playback stopped.';
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    document.dispatchEvent(new Event('manual-flyover-start'));
    playPass();
  });
  preview.addEventListener('play', () => { stop.disabled = false; });
  preview.addEventListener('pause', () => { stop.disabled = true; });
  stop.addEventListener('click', stopPlayback);
  document.addEventListener('traffic-start', () => {
    if (!preview.paused || !stop.disabled) stopPlayback();
    else playRequest++;
    preview.hidden = true;
  });
  document.querySelector('#download').addEventListener('click', () => {
    if (!form.reportValidity()) return;
    const url = URL.createObjectURL(prepare().blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dopplerspoof-flyover-scene.wav';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
