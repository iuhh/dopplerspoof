'use strict';

// Clearance spacing is independent of flight duration, so passes can overlap.
const trafficSpacing = { quiet: [24, 48], steady: [8, 24], busy: [4, 13] };
const trafficLookahead = 9;

function trafficFlight(id, start, region, random = Math.random) {
  const between = (min, max) => min + (max - min) * random();
  const types = Object.keys(aircraftPresets);
  const aircraft = random() < 0.35 ? countryAircraft[region] : types[Math.floor(random() * types.length)];
  const preset = aircraftPresets[aircraft];
  return {
    id, start, aircraft, voice: id + Math.floor(between(0, 100000)),
    track: between(0, 360), knots: preset.knots + between(-12, 16),
    feet: between(650, 3000), offset: between(-1050, 1050),
    rpm: Math.min(preset.maxRpm, preset.rpm + between(-230, 110)),
  };
}

function trafficPosition(flight, time) {
  const angle = flight.track * Math.PI / 180;
  const distance = (time - flight.closest) * flight.knots * 1852 / 3600;
  return [
    distance * Math.sin(angle) + flight.offset * Math.cos(angle),
    flight.feet * 0.3048,
    distance * Math.cos(angle) - flight.offset * Math.sin(angle),
  ];
}

if (typeof document !== 'undefined') {
  const start = document.querySelector('#traffic-start');
  const density = document.querySelector('#traffic-density');
  const camera = document.querySelector('#traffic-camera');
  const heading = document.querySelector('#room-heading');
  const level = document.querySelector('#level');
  const flightList = document.querySelector('#traffic-flights');
  const status = document.querySelector('#traffic-status');
  const form = document.querySelector('#flyover');
  const view = document.querySelector('#traffic-view');
  let session;

  function draw() {
    const time = session?.audio.currentTime ?? 0;
    const visible = session ? session.flights.filter(flight => flight.start <= time && flight.end > time) : [];
    drawTraffic(view, visible, time, camera.value, Number(heading.value));
    const names = visible.map(flight => aircraftPresets[flight.aircraft].name);
    const label = names.length ? names.join(' · ') : 'Clear sky';
    if (flightList.textContent !== label) flightList.textContent = label;
  }

  function stopTraffic(message = 'Traffic stopped.') {
    const current = session;
    session = undefined;
    if (current) {
      clearInterval(current.timer);
      cancelAnimationFrame(current.frame);
      current.worker?.terminate();
      current.audio.close().catch(() => {});
    }
    start.textContent = 'Start traffic';
    start.setAttribute('aria-pressed', 'false');
    flightList.hidden = true;
    status.textContent = message;
    draw();
  }

  function playFlight(current, flight, sound) {
    if (current !== session) return;
    const { audio } = current;
    const buffer = audio.createBuffer(sound.pcm.length, sound.pcm[0].length, sound.sampleRate);
    sound.pcm.forEach((samples, channel) => buffer.copyToChannel(samples, channel));
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const envelope = audio.createGain();
    source.connect(envelope).connect(current.volume);
    const when = Math.max(flight.start, audio.currentTime + 0.03);
    const skip = flight.skip + when - flight.start;
    if (skip >= buffer.duration) return;
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(1, when + 0.5);
    source.start(when, skip);
    flight.closest = flight.start + buffer.duration / 2 - sound.delay - flight.skip;
    flight.end = flight.start + buffer.duration - flight.skip;
    current.flights.push(flight);
  }

  function queue(current) {
    const now = current.audio.currentTime;
    current.flights = current.flights.filter(flight => flight.end > now);
    if (current.pending || current.next > now + trafficLookahead) return;
    // After a throttled tab resumes, continue from the current clock.
    current.next = Math.max(current.next, now + 0.2);
    const flight = trafficFlight(current.id++, current.next, form.elements.country.value);
    flight.skip = flight.id === 1 ? 8 : 0;
    const [min, max] = trafficSpacing[density.value];
    current.next += min + Math.random() * (max - min);
    if (flight.id === 1) current.next = flight.start + min;
    const input = {
      ...flight,
      facing: Number(form.elements.facing.value) || 0,
      channels: Number(form.elements.channels.value),
    };
    current.pending = flight;
    if (current.worker) current.worker.postMessage(input);
    else {
      // Local file previews cannot start a classic worker in some browsers.
      setTimeout(() => {
        if (current !== session) return;
        try {
          receive(current, renderFlyover(input));
        } catch (error) {
          stopTraffic(`Traffic failed. ${error.message}`);
        }
      }, 0);
    }
  }

  function receive(current, sound) {
    if (current !== session) return;
    playFlight(current, current.pending, sound);
    current.pending = undefined;
    queue(current);
  }

  async function startTraffic() {
    let current;
    try {
      document.dispatchEvent(new Event('traffic-start'));
      const audio = new AudioContext();
      current = session = { audio, flights: [], id: 1, next: 0 };
      current.volume = audio.createGain();
      current.volume.gain.value = 10 ** (Number(level.value) / 20);
      const limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.ratio.value = 12;
      current.volume.connect(limiter).connect(audio.destination);
      start.textContent = 'Stop traffic';
      start.setAttribute('aria-pressed', 'true');
      status.textContent = 'Starting traffic…';
      await audio.resume();
      if (current !== session) return;
      if (location.protocol !== 'file:') {
        current.worker = new Worker('traffic-worker.js');
        current.worker.onmessage = event => {
          if (current !== session) return;
          try {
            receive(current, event.data);
          } catch (error) {
            stopTraffic(`Traffic failed. ${error.message}`);
          }
        };
        current.worker.onerror = event => {
          if (current === session) stopTraffic(`Traffic failed. ${event.message || 'Audio worker unavailable.'}`);
        };
      }
      current.next = audio.currentTime + 0.35;
      queue(current);
      current.timer = setInterval(() => queue(current), 500);
      const animate = () => {
        draw();
        current.frame = requestAnimationFrame(animate);
      };
      animate();
      flightList.hidden = false;
      status.textContent = 'Traffic running.';
    } catch (error) {
      if (current === session) stopTraffic(`Traffic failed. ${error.message}`);
    }
  }

  start.addEventListener('click', () => session ? stopTraffic() : startTraffic());
  document.addEventListener('manual-flyover-start', () => { if (session) stopTraffic(); });
  level.addEventListener('input', () => {
    if (session) session.volume.gain.setTargetAtTime(10 ** (Number(level.value) / 20), session.audio.currentTime, 0.02);
  });
  camera.addEventListener('change', () => {
    document.querySelector('#room-direction').hidden = camera.value !== 'room';
    draw();
  });
  heading.addEventListener('input', () => {
    heading.setAttribute('aria-valuetext', `${heading.value} degrees`);
    draw();
  });
  draw();
}
