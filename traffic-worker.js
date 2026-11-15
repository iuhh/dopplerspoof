'use strict';

importScripts('flyover.js');

self.onmessage = ({ data }) => {
  const sound = renderFlyover(data);
  self.postMessage(sound, sound.pcm.map(channel => channel.buffer));
};
