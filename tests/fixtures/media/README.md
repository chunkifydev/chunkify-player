# Local media fixture

This six-second clip contains an FFmpeg-generated test pattern and sine wave. It
has H.264 baseline video at 256 x 144, 12 frames per second, and AAC audio. No
customer media or external service is used.

`video.mp4` is a fast-start MP4. `master.m3u8` points to `stream.m3u8`, which uses
three fMP4 segments and `init.mp4`. `poster.jpg` is a frame from the same clip.
`thumbnails.vtt` uses that image as a seek-preview fixture.
`captions-en.vtt` and `captions-fr.vtt` provide sample captions for the basic
player example.

CI uses the checked-in files and does not need FFmpeg.

`background/` contains a separate 30-second, video-only test pattern at 64 x 36
and 12 frames per second. Its MP4 and three ten-second fMP4 segments let background
playback tests run past eleven seconds at normal speed. Slowing the six-second
clip changes seeking and playback timing differently across media engines.

To regenerate these files with FFmpeg and libx264, run from the repository root:

```sh
ffmpeg -f lavfi -i testsrc2=size=64x36:rate=12 -t 30 -an \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -crf 32 \
  -g 24 -keyint_min 24 -sc_threshold 0 -movflags +faststart \
  tests/fixtures/media/background/video.mp4
ffmpeg -i tests/fixtures/media/background/video.mp4 -map 0:v:0 -c copy \
  -f hls -hls_time 10 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_segment_filename tests/fixtures/media/background/segment%02d.m4s \
  tests/fixtures/media/background/stream.m3u8
```

`quality/master.m3u8` adds 720p and 2160p encodes of the same clip for quality
selection tests and the basic example. These are upscaled test patterns, not
samples of HD/4K image detail. Generate each rendition with the command below,
substituting `720` or `2160` for `HEIGHT`:

```sh
ffmpeg -i tests/fixtures/media/video.mp4 -vf scale=-2:HEIGHT \
  -c:v libx264 -profile:v baseline -preset veryfast -crf 35 \
  -g 24 -keyint_min 24 -sc_threshold 0 -c:a copy \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_segment_filename tests/fixtures/media/quality/HEIGHTp/segment%02d.m4s \
  tests/fixtures/media/quality/HEIGHTp/stream.m3u8
```
