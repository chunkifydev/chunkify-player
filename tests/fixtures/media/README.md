# Local media fixture

This six-second clip contains an FFmpeg-generated test pattern and sine wave.
It has H.264 baseline video at 256 x 144, 12 frames per second, and AAC audio.
No customer media or external service is used. The generated fixtures are
covered by this repository's MIT license.

`video.mp4` is a fast-start MP4. `master.m3u8` points to the muxed audio/video
rendition `stream.m3u8`, which uses three fMP4 segments and `init.mp4`.

To regenerate the binary fixtures from the repository root with FFmpeg installed:

```sh
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=256x144:rate=12 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 6 -c:v libx264 -profile:v baseline -pix_fmt yuv420p \
  -g 24 -keyint_min 24 -sc_threshold 0 -c:a aac -b:a 32k \
  -movflags +faststart tests/fixtures/media/video.mp4

ffmpeg -y -hide_banner -loglevel error -i tests/fixtures/media/video.mp4 \
  -c copy -hls_time 2 -hls_segment_type fmp4 -hls_playlist_type vod \
  -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename 'tests/fixtures/media/segment%02d.m4s' \
  tests/fixtures/media/stream.m3u8

ffmpeg -y -hide_banner -loglevel error -i tests/fixtures/media/video.mp4 \
  -frames:v 1 -update 1 tests/fixtures/media/poster.jpg
```

CI uses the checked-in fixtures and does not need FFmpeg.
