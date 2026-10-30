# Changelog

## [0.6.0](https://github.com/chunkifydev/chunkify-player/compare/analytics-v0.5.0...analytics-v0.6.0) (2026-10-30)


### Features

* **analytics:** include page origin and path in browser context ([5e4f5f6](https://github.com/chunkifydev/chunkify-player/commit/5e4f5f6b331a057de113838772ae53abad0770ae))

## [0.5.0](https://github.com/chunkifydev/chunkify-player/compare/analytics-v0.4.0...analytics-v0.5.0) (2026-10-21)


### Features

* **analytics:** add bounded adapter retries ([e43aca1](https://github.com/chunkifydev/chunkify-player/commit/e43aca1e4ed7076e6fdbe7b76c7297d84386fd9f))

## [0.4.0](https://github.com/chunkifydev/chunkify-player/compare/analytics-v0.3.0...analytics-v0.4.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* **analytics:** HTTP and OTLP mapper callbacks now belong in the options object as mapEvent and mapAttributes respectively.

### Features

* **analytics:** add Chunkify adapter and configurable headers ([589238d](https://github.com/chunkifydev/chunkify-player/commit/589238d8d90f07391eed94f899d929e5fecb4c66))

## [0.3.0](https://github.com/chunkifydev/chunkify-player/compare/analytics-v0.2.1...analytics-v0.3.0) (2026-09-30)


### Features

* **analytics:** record displayed player size ([7f086eb](https://github.com/chunkifydev/chunkify-player/commit/7f086ebecb5781e4ef59fad3f3cb869b486ea017))

## [0.2.1](https://github.com/chunkifydev/chunkify-player/compare/analytics-v0.2.0...analytics-v0.2.1) (2026-09-30)


### Documentation

* **analytics:** explain event choices for reporting ([bf99a02](https://github.com/chunkifydev/chunkify-player/commit/bf99a02b1597883f6b6ae39d990b0137f8db1304))


### Refactors

* **analytics:** shorten media dimension fields ([8bd34a4](https://github.com/chunkifydev/chunkify-player/commit/8bd34a4ec5b9b5038cb02be1c67ed7ffb85fe2d1))

## [0.2.0](https://github.com/chunkifydev/chunkify-player/compare/analytics-v0.1.0...analytics-v0.2.0) (2026-09-29)


### Features

* **analytics:** group rapid seeks into one event ([3c427da](https://github.com/chunkifydev/chunkify-player/commit/3c427daee76b433cffc8eaea7958f99148dba76e))
* **analytics:** group rapid seeks into one timeline event ([22c620d](https://github.com/chunkifydev/chunkify-player/commit/22c620dba3f30c54b30dc003f5d2f8585a658478))
* **analytics:** include seek timeline boundaries ([3fcd156](https://github.com/chunkifydev/chunkify-player/commit/3fcd156481174bf0442c2a4ff30993bba1b62ff2))


### Documentation

* **analytics:** clarify event selection and field mapping ([aeda0c9](https://github.com/chunkifydev/chunkify-player/commit/aeda0c944ec91cd6c8427e8a7c937b0a2583eeed))
* **analytics:** show event-specific mapping with HTTP ([dc7c04f](https://github.com/chunkifydev/chunkify-player/commit/dc7c04f1cfe3c0edf091c912ce3908f5d6d09b70))

## 0.1.0 (2026-09-28)


### Features

* **analytics:** add destination adapters and HTTP delivery ([ba4af17](https://github.com/chunkifydev/chunkify-player/commit/ba4af1740a0947d838a83f4e1f8247fbe277c7f6))
* **analytics:** add OTLP log destination ([dfb47e6](https://github.com/chunkifydev/chunkify-player/commit/dfb47e61d12cdae149b41475febb575a5080d05f))
* **analytics:** add PostHog destination adapter ([7f13666](https://github.com/chunkifydev/chunkify-player/commit/7f13666f316592178c8553b0b50d195db1663f17))
* **analytics:** add reusable event mapper ([35e03e5](https://github.com/chunkifydev/chunkify-player/commit/35e03e5860a99b9197a41537fca54d74443e4275))
* **analytics:** allow mapping OTLP log attributes ([1979a16](https://github.com/chunkifydev/chunkify-player/commit/1979a1692d5e023ac445ad493d89ed25f1f24437))
* **analytics:** classify playback startup outcome ([06a4725](https://github.com/chunkifydev/chunkify-player/commit/06a4725b6eddf983efeebf00f660d2b335ec813d))
* **analytics:** configure snapshots and emitted events ([cebb213](https://github.com/chunkifydev/chunkify-player/commit/cebb2139f266a8fef7dee3c11bb166a389697fad))
* **analytics:** emit playback timeline and rendition changes ([b8618d7](https://github.com/chunkifydev/chunkify-player/commit/b8618d79e2b07a202c3942412f004b3184180888))
* **analytics:** expose player monitors from package root ([b80d677](https://github.com/chunkifydev/chunkify-player/commit/b80d677caea21f639103466ad606b9df80855466))
* **analytics:** flatten playback event measurements ([6692e47](https://github.com/chunkifydev/chunkify-player/commit/6692e474d88c8edb95605c34c4d1e99cc00320cd))
* **analytics:** measure first video frame callback ([fc70429](https://github.com/chunkifydev/chunkify-player/commit/fc704293b267cda4869a2e27a70ee273a6863a6d))
* **analytics:** monitor Shaka playback ([3e1dc32](https://github.com/chunkifydev/chunkify-player/commit/3e1dc32cf73e99dc333f91cd9d2b2cef8cf634f6))
* **analytics:** monitor Video.js playback ([bbc76b2](https://github.com/chunkifydev/chunkify-player/commit/bbc76b20a4960b0426797677e5e31c7bf85bd70e))
* **analytics:** record player and video dimensions ([fc07379](https://github.com/chunkifydev/chunkify-player/commit/fc073798181969d385391bf06c79af17264d6709))
* **analytics:** support Video.js 10 media components ([5b8ddbb](https://github.com/chunkifydev/chunkify-player/commit/5b8ddbbfb6b2bfbcafc08cb1357c53d6dd75a06e))


### Bug Fixes

* **analytics:** distinguish Video.js HLS media from Mux ([7aa4a06](https://github.com/chunkifydev/chunkify-player/commit/7aa4a069d4f03f87b3c85b540647f9cbbec8f5e6))
* **analytics:** keep one view during hls.js media recovery ([3ce442a](https://github.com/chunkifydev/chunkify-player/commit/3ce442a6ba38051bcbbe54797c630cd75eecdc36))
* **analytics:** let hls.js own media source changes ([a40485d](https://github.com/chunkifydev/chunkify-player/commit/a40485d24ecd840d874531688df9b7e1f41be622))
* **analytics:** reset connector state across source changes ([aeeae91](https://github.com/chunkifydev/chunkify-player/commit/aeeae9182a2bc58aac575936aa90f6a8a067a8b6))
* **analytics:** send flat Datadog action context ([ccd6dbc](https://github.com/chunkifydev/chunkify-player/commit/ccd6dbcd92ebb26f3e9e28b6ccf6e602ae0d631e))
* **analytics:** start event schema at version 1 ([c7e9ec3](https://github.com/chunkifydev/chunkify-player/commit/c7e9ec3b1fd58217b24305937155bb9cf8073af9))


### Documentation

* **analytics:** explain monitor options beside examples ([0a27364](https://github.com/chunkifydev/chunkify-player/commit/0a273643f1fbc9a6da3e2b3b7df23316e520fa7f))
* **analytics:** link monitor options from mapper guide ([3ee0583](https://github.com/chunkifydev/chunkify-player/commit/3ee05837cb188abb7b9aa07aabcdb980980ba094))
* **analytics:** pair player markup with monitor examples ([1aea945](https://github.com/chunkifydev/chunkify-player/commit/1aea94563b97794de86a5e0f15c63a2d3330a479))
* **analytics:** remove local connector test instructions ([a695ea4](https://github.com/chunkifydev/chunkify-player/commit/a695ea415e245a005f8ac90afa302a8794bf9368))
* **analytics:** show minimal Datadog and PostHog setup ([d1a18ae](https://github.com/chunkifydev/chunkify-player/commit/d1a18ae66c793cb268bccfe7c34f0b1b28201bd2))
* explain per-attempt analytics sampling ([efb3957](https://github.com/chunkifydev/chunkify-player/commit/efb3957b7d1f5e5d637827b59ef53cccaf58ac40))
* organize analytics integration guide ([41b8b9f](https://github.com/chunkifydev/chunkify-player/commit/41b8b9f56330feec888f5498234a8da67cd905a6))
* show complete analytics event payload ([06bec5b](https://github.com/chunkifydev/chunkify-player/commit/06bec5bf7724022e409d3e3121605e3c5f8a29f7))
* use Chunkify Player analytics event example ([64bc3b3](https://github.com/chunkifydev/chunkify-player/commit/64bc3b385ddb012cee1be0e210e0b34d08abb3d0))


### Refactors

* **analytics:** keep Datadog adapter event-focused ([8a5d8ac](https://github.com/chunkifydev/chunkify-player/commit/8a5d8acfefb921e1316802f4653f777b7fbae2a4))
* **analytics:** remove player size metrics ([4e8dd5a](https://github.com/chunkifydev/chunkify-player/commit/4e8dd5addd4209199648277a26b9372d89ff9091))
* **analytics:** remove view sampling ([ead4141](https://github.com/chunkifydev/chunkify-player/commit/ead4141e98898f06829226a3e7d46a4bc41f4ac2))
* rename telemetry package to analytics ([2752d77](https://github.com/chunkifydev/chunkify-player/commit/2752d772fce4b1d3858adddc76790bf9b863aa12))


### Build System

* **analytics:** prepare Release Please and npm publication ([5e67dcb](https://github.com/chunkifydev/chunkify-player/commit/5e67dcbd341e71d21b0839489a245a956bc67305))
