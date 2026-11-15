# DopplerSpoof

[Run DopplerSpoof in your browser](https://iuhh.github.io/dopplerspoof/)

DopplerSpoof is a browser-based lab for simulating aircraft flyovers and inspecting the Doppler curves they leave in recordings.

## Inspiration

The project started with Colsto's demonstration of how faint aircraft sounds in a security-camera recording can be matched to historical flight tracks to infer where it was recorded. [Watch the original YouTube video](https://www.youtube.com/watch?v=UytYrhYLOKI)

We also looked at an independent reconstruction that tested the geolocation method with synthetic flyovers, and at a second project that documented the demonstration step by step. [cbonitz/doppler-experiments](https://github.com/cbonitz/doppler-experiments) · [ArgeliusLabs/DopplerLab](https://github.com/ArgeliusLabs/DopplerLab)

## What we set out to do

We wanted to hear what simulated flyovers sound like, compare their Doppler curves with real recordings, and explore whether editing aircraft sound could reduce the location clues in a recording. The current app lets you build a flyover scene, play it back, export a WAV, and plot the simulated flyover alongside a recording you choose. It also has a live air traffic simulator.

Recordings are processed locally in your browser. The [audio privacy research](docs/research/doppler-audio-privacy.md) describes how to test whether an edit reduces geolocation accuracy.
