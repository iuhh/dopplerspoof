'use strict';

const fftSize = 8192;
const hann = Float64Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));

function fft(real, imag) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= size; length *= 2) {
    const half = length / 2;
    for (let j = 0; j < half; j++) {
      const angle = -2 * Math.PI * j / length;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (let i = j; i < size; i += length) {
        const k = i + half;
        const r = real[k] * cos - imag[k] * sin;
        const q = real[k] * sin + imag[k] * cos;
        real[k] = real[i] - r;
        imag[k] = imag[i] - q;
        real[i] += r;
        imag[i] += q;
      }
    }
  }
}

function spectrum(samples, rate, start, seconds, ceiling, columns, window = hann, size = fftSize) {
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const count = Math.min(size / 2, Math.ceil(ceiling * size / rate) + 1);
  const powerScale = (window.length / 4) ** 2;
  const bins = Array.from({ length: count }, () => new Float32Array(columns));
  for (let x = 0; x < columns; x++) {
    const first = Math.round((start + seconds * x / (columns - 1)) * rate) - Math.floor(window.length / 2);
    for (let i = 0; i < window.length; i++) real[i] = (samples[first + i] ?? 0) * window[i];
    real.fill(0, window.length);
    imag.fill(0);
    fft(real, imag);
    bins.forEach((bin, i) => {
      bin[x] = 10 * Math.log10(Math.max(1e-16, (real[i] ** 2 + imag[i] ** 2) / powerScale));
    });
  }
  return bins;
}

function measuredRidge(samples, rate, start, seconds, floor, ceiling) {
  const size = 2 ** Math.ceil(Math.log2(rate * 4));
  const window = Float64Array.from({ length: rate }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (rate - 1)));
  const columns = Math.max(2, Math.round(seconds * 4) + 1);
  const spacing = rate / size;
  const bins = spectrum(samples, rate, start, seconds, ceiling, columns, window, size)
    .slice(Math.ceil(floor / spacing), Math.floor(ceiling / spacing) + 1);
  const baseline = bins.map(bin => Math.max(-100, bin.slice().sort()[Math.floor(columns / 2)]));
  const peaks = Array.from({ length: columns }, (_, x) => {
    const relative = bins.map((bin, i) => bin[x] - baseline[i]);
    const peak = relative.reduce((best, value, i) => value > relative[best] ? i : best, 0);
    const median = relative.slice().sort((a, b) => a - b)[Math.floor(relative.length / 2)];
    if (relative[peak] < 6 || relative[peak] - median < 10) return null;
    return (Math.ceil(floor / spacing) + peak) * spacing;
  });
  return peaks.map((hz, i) => {
    if (hz === null) return null;
    const nearby = peaks.slice(Math.max(0, i - 3), i + 4)
      .filter(point => point !== null).sort((a, b) => a - b);
    // Keep the measured frequency and discard brief jumps to competing tones.
    return nearby.length >= 3 && Math.abs(hz - nearby[Math.floor(nearby.length / 2)]) <= 8 ? hz : null;
  });
}

function drawRidge(canvas, audio, start, seconds, floor, ceiling, title) {
  const ctx = canvas.getContext('2d');
  const left = 56, top = 34, width = canvas.width - left - 25, height = canvas.height - top - 40;
  const points = measuredRidge(audio.getChannelData(0), audio.sampleRate, start, seconds, floor, ceiling);
  ctx.fillStyle = '#fffefa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '14px system-ui';
  ctx.fillStyle = '#172724';
  ctx.fillText(`${title} · measured ridge · first channel`, left, 21);
  ctx.fillText('Hz', 8, 21);
  for (let i = 0; i <= 4; i++) {
    const y = top + height * (1 - i / 4);
    ctx.fillStyle = '#d5ded5';
    ctx.fillRect(left, y, width, 1);
    ctx.fillStyle = '#172724';
    ctx.fillText(String(Math.round(floor + (ceiling - floor) * i / 4)), 8, y + 4);
    ctx.fillText(`${(start + seconds * i / 4).toFixed(1)} s`, left - 10 + width * i / 4, top + height + 22);
  }
  ctx.fillStyle = '#1855a7';
  points.forEach((hz, i) => {
    if (hz === null) return;
    const x = left + width * i / (points.length - 1);
    const y = top + height * (ceiling - hz) / (ceiling - floor);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.fill();
  });
  canvas.hidden = false;
  return points.filter(hz => hz !== null).length;
}

function drawSpectrum(canvas, audio, start, seconds, floor, ceiling, title) {
  const ctx = canvas.getContext('2d');
  const left = 56, top = 32, width = canvas.width - left - 16, height = canvas.height - top - 36;
  const firstChannel = audio.getChannelData(0);
  const bins = spectrum(firstChannel, audio.sampleRate, start, seconds, ceiling, width);
  const noise = bins.map(bin => bin.slice().sort()[Math.floor(width / 2)]);
  const picture = ctx.createImageData(width, height);
  const palette = Array.from({ length: 256 }, (_, i) => {
    const strength = i / 255;
    const blue = Math.min(1, strength * 2);
    const violet = Math.max(0, strength * 2 - 1);
    return [3 + 13 * blue + 133 * violet, 7 + 36 * blue + 17 * violet, 16 + 64 * blue + 102 * violet, 255];
  });
  for (let y = 0; y < height; y++) {
    const hz = floor + (ceiling - floor) * (1 - y / (height - 1));
    const bin = Math.round(hz * fftSize / audio.sampleRate);
    for (let x = 0; x < width; x++) {
      const signal = bins[bin][x];
      const strength = Math.max(0, Math.min(1, (signal - Math.max(-100, noise[bin]) - 3) / 27));
      const pixel = 4 * (y * width + x);
      picture.data.set(palette[Math.round(strength * 255)], pixel);
    }
  }
  ctx.fillStyle = '#080f1e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(picture, left, top);
  ctx.fillStyle = '#e9f2f1';
  ctx.font = '14px system-ui';
  ctx.fillText(`${title} · first channel · brightness relative to each frequency’s median`, left, 21);
  for (let i = 0; i <= 4; i++) {
    const y = top + height * (1 - i / 4);
    ctx.fillStyle = '#e9f2f1';
    ctx.fillText(`${Math.round(floor + (ceiling - floor) * i / 4)}`, 8, y + 4);
    const x = left + (width - 36) * i / 4;
    ctx.fillText(`${(start + seconds * i / 4).toFixed(1)} s`, x, top + height + 22);
    ctx.fillStyle = 'rgba(131, 152, 200, .2)';
    ctx.fillRect(left, y, width, 1);
  }
  ctx.fillStyle = '#e9f2f1';
  ctx.fillText('Hz', 8, 21);
  canvas.hidden = false;
}

if (typeof module !== 'undefined') module.exports = { spectrum, measuredRidge };

if (typeof document !== 'undefined') {
  const analysis = document.querySelector('#analysis');
  const reference = document.querySelector('#reference');
  const analysisStatus = document.querySelector('#analysis-status');
  const generatedStatus = document.querySelector('#generated-analysis-status');
  let cached;
  const requests = new WeakMap();

  async function decode(blob) {
    const context = new AudioContext({ sampleRate: 12000 });
    try {
      return await context.decodeAudioData(await blob.arrayBuffer());
    } finally {
      await context.close();
    }
  }

  async function plot(blob, canvasId, title, status) {
    if (!blob || !analysis.reportValidity()) return;
    const current = Symbol();
    requests.set(status, current);
    const { start, seconds, lowFrequency, frequency, view } = Object.fromEntries(new FormData(analysis));
    const floor = Number(lowFrequency);
    const ceiling = Number(frequency);
    if (floor >= ceiling) {
      status.textContent = 'Set the lower frequency below the upper frequency.';
      return;
    }
    status.textContent = 'Reading audio locally…';
    try {
      const audio = cached?.blob === blob ? cached.audio : await decode(blob);
      if (current !== requests.get(status)) return;
      cached = { blob, audio };
      const duration = Math.min(Number(seconds), audio.duration - Number(start));
      if (duration <= 0) throw new Error(`Choose a start before ${audio.duration.toFixed(1)} s.`);
      const canvas = document.querySelector(canvasId);
      if (view === 'ridge') {
        const count = drawRidge(canvas, audio, Number(start), duration, floor, ceiling, title);
        status.textContent = `${title} · ${count} candidate ridge points. Competing tones can produce jumps. Narrow the band if needed.`;
      } else {
        drawSpectrum(canvas, audio, Number(start), duration, floor, ceiling, title);
        status.textContent = `${title} · ${duration.toFixed(1)} s plotted. Bright bands show energy above the local frequency baseline.`;
      }
    } catch (error) {
      if (current === requests.get(status)) status.textContent = `Could not plot ${title.toLowerCase()}. ${error.name === 'EncodingError' ? 'Try an extracted WAV audio track if this browser cannot decode the file.' : error.message}`;
    }
  }

  analysis.addEventListener('submit', event => {
    event.preventDefault();
    const file = reference.files[0];
    if (file) plot(file, '#spectrum', 'Reference', analysisStatus);
    else analysisStatus.textContent = 'Choose a recording first.';
  });
  document.querySelector('#plot-generated').addEventListener('click', () => {
    plot(window.generatedFlyover(), '#generated-spectrum', 'Simulated flyover', generatedStatus);
  });
}
