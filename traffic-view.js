'use strict';

const trafficBackdrops = new WeakMap();

function trafficBackdrop(canvas, room) {
  const { width, height } = canvas;
  let cache = trafficBackdrops.get(canvas);
  if (!cache || cache.width !== width || cache.height !== height) {
    cache = { width, height };
    trafficBackdrops.set(canvas, cache);
  }
  const key = room ? 'room' : 'overview';
  if (cache[key]) return cache[key];

  const backdrop = canvas.ownerDocument.createElement('canvas');
  backdrop.width = width;
  backdrop.height = height;
  const ctx = backdrop.getContext('2d');
  ctx.scale(width / 960, height / 540);
  const sky = ctx.createLinearGradient(0, 0, 0, 540);
  sky.addColorStop(0, room ? '#173b66' : '#070e22');
  sky.addColorStop(0.46, room ? '#4595ac' : '#163344');
  sky.addColorStop(1, room ? '#bde1cf' : '#0a242d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 960, 540);

  function glow(x, y, radius, color, spreadX = 1, spreadY = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(spreadX, spreadY);
    const light = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    light.addColorStop(0, color);
    light.addColorStop(1, 'transparent');
    ctx.fillStyle = light;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }

  glow(744, 105, 330, room ? '#ffedb5b8' : '#5ee6c85c', 1.3, 0.82);
  glow(746, 105, room ? 46 : 85, room ? '#fff7d8' : '#b4ffdc64');
  glow(200, 365, 290, room ? '#8ad1ef85' : '#326fba55', 1.35, 0.6);

  // Fixed seed keeps the texture stable while playback advances.
  let seed = 84;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  for (let bank = 0; bank < 6; bank++) {
    const x = random() * 1100 - 70;
    const y = 130 + random() * 330;
    for (let puff = 0; puff < 16; puff++) {
      glow(x + (random() - 0.5) * 480, y + (random() - 0.5) * 58,
        40 + random() * 85, room ? '#e1f6ed23' : '#77d8cd10', 1.85, 0.21 + random() * 0.22);
    }
  }

  if (!room) {
    for (let speck = 0; speck < 190; speck++) {
      ctx.fillStyle = speck % 7 === 0 ? '#c4ffdf49' : '#a1cbd024';
      ctx.fillRect(random() * 960, random() * 540, 0.6 + random(), 1);
    }
  }
  glow(480, 260, 700, '#a2eee214', 1, 0.76);
  cache[key] = backdrop;
  return backdrop;
}

function drawTraffic(canvas, flights, time, mode, heading) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const room = mode === 'room';
  const yaw = (room ? heading : -24) * Math.PI / 180;
  const pitch = (room ? 60 : -22) * Math.PI / 180;
  const eye = room ? [0, 0, 0] : [2000, 2200, -4500];
  const focal = room ? width * 0.36 : width * 0.65;
  const palette = ['#a4f9cd', '#ffcf91', '#8de6ff', '#ffaebb', '#dbbcff'];
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);

  function project([east, up, north]) {
    const x = east - eye[0];
    const y = up - eye[1];
    const z = north - eye[2];
    const right = x * cosYaw - z * sinYaw;
    const forward = x * sinYaw + z * cosYaw;
    const depth = forward * cosPitch + y * sinPitch;
    if (depth < 12) return null;
    const vertical = y * cosPitch - forward * sinPitch;
    return [width / 2 + focal * right / depth, height * 0.48 - focal * vertical / depth, depth];
  }

  function path(points, color, fill = false) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  function line(from, to, color) {
    const points = [project(from), project(to)];
    if (points.every(Boolean)) path(points, color);
  }

  function label(text, x, y, color = '#dcebe1') {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = '600 16px system-ui';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#071624d9';
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  ctx.drawImage(trafficBackdrop(canvas, room), 0, 0);
  const frame = ([x, y]) => [x * width / 960, y * height / 540];
  const skylight = [[105, 45], [855, 45], [940, 455], [20, 455]].map(frame);
  ctx.save();
  if (room) {
    // The seat stays fixed as the listener turns to look through the skylight.
    const opening = new Path2D();
    opening.moveTo(...skylight[0]);
    for (const point of skylight.slice(1)) opening.lineTo(...point);
    opening.closePath();
    ctx.clip(opening);
  } else {
    const corners = [[-3000, 0, -3000], [3000, 0, -3000],
      [3000, 0, 3000], [-3000, 0, 3000]].map(project);
    const surface = ctx.createLinearGradient(0, corners[2][1], 0, height);
    surface.addColorStop(0, '#5fe9cb0c');
    surface.addColorStop(1, '#2b9eae62');
    path(corners, surface, true);

    for (let offset = -3000; offset <= 3000; offset += 500) {
      const color = offset === 0 ? '#96ead370' : '#83dacc3a';
      line([offset, 0, -3000], [offset, 0, 3000], color);
      line([-3000, 0, offset], [3000, 0, offset], color);
    }
    const seat = project([0, 0, 0]);
    for (const radius of [250, 550]) {
      const ring = Array.from({ length: 49 }, (_, index) => {
        const angle = index * Math.PI / 24;
        return project([radius * Math.cos(angle), 0, radius * Math.sin(angle)]);
      });
      path(ring, radius === 250 ? '#a5ffe594' : '#a5ffe545');
    }
    ctx.save();
    ctx.shadowColor = '#84ffdc';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(seat[0], seat[1], 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#d2fff0';
    ctx.fill();
    ctx.restore();
    label('Listener', seat[0] + 12, seat[1] + 7);
    label('N', ...project([0, 0, 2800]));
    label('E', ...project([2800, 0, 0]));
    label('S', ...project([0, 0, -2800]));
    label('W', ...project([-2800, 0, 0]));
  }

  const planes = flights.map(flight => {
    const position = trafficPosition(flight, time);
    return { flight, position, screen: project(position) };
  }).filter(plane => plane.screen).sort((a, b) => b.screen[2] - a.screen[2]);

  for (const { flight, position, screen } of planes) {
    const [x, y, depth] = screen;
    const color = palette[flight.id % palette.length];
    const ahead = project(trafficPosition(flight, time + 1));
    if (!room) {
      ctx.setLineDash([4, 6]);
      line(trafficPosition(flight, flight.start), trafficPosition(flight, flight.end), color + '82');
      line([position[0], 0, position[2]], position, '#a8e3df77');
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.translate(x, y);
    if (ahead) ctx.rotate(Math.atan2(ahead[1] - y, ahead[0] - x) + Math.PI / 2);
    const size = room ? Math.min(2, Math.max(0.42, 520 / depth)) : 1;
    ctx.scale(size, size);
    ctx.shadowColor = room ? '#fff4d9a0' : color;
    ctx.shadowBlur = room ? 3 : 9;
    path([[0, -12], [2, -6], [2.5, -2], [13, 2], [13, 5], [2, 3], [1, 8],
      [5, 10], [5, 12], [0, 11], [-5, 12], [-5, 10], [-1, 8], [-2, 3], [-13, 5],
      [-13, 2], [-2.5, -2], [-2, -6]], room ? '#101f32' : color, true);
    ctx.restore();
    if (!room) label(aircraftPresets[flight.aircraft].name, Math.min(x + 18, width - 175), y - 12, color);
  }
  ctx.restore();

  if (room) {
    const wall = ctx.createLinearGradient(0, 0, width, height);
    wall.addColorStop(0, '#101a2a');
    wall.addColorStop(0.63, '#303646');
    wall.addColorStop(1, '#594b4a');
    path([[0, 0], [960, 0], [960, 45], [0, 45]].map(frame), '#101927', true);
    path([[0, 45], [105, 45], [20, 455], [0, 540]].map(frame), wall, true);
    path([[855, 45], [960, 45], [960, 540], [940, 455]].map(frame), wall, true);
    const sill = ctx.createLinearGradient(0, skylight[2][1], 0, height);
    sill.addColorStop(0, '#564b4d');
    sill.addColorStop(1, '#111829');
    path([[20, 455], [940, 455], [960, 540], [0, 540]].map(frame), sill, true);
    const trim = ctx.createLinearGradient(0, 0, width, height);
    trim.addColorStop(0, '#627686');
    trim.addColorStop(0.7, '#b5a58c');
    trim.addColorStop(1, '#66535a');
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10 * width / 960;
    path([...skylight, skylight[0]], '#101927');
    ctx.lineWidth = 4 * width / 960;
    path([...skylight, skylight[0]], trim);
    path([[480, 45], [480, 455]].map(frame), trim);
    ctx.restore();
    label(`Skylight · ${heading}°`, ...frame([28, 511]));
  }
}
