# Local media fixture

This six-second clip contains an FFmpeg-generated test pattern and sine wave. It
has H.264 baseline video at 256 x 144, 12 frames per second, and AAC audio. No
customer media or external service is used.

`video.mp4` is a fast-start MP4. `master.m3u8` points to `stream.m3u8`, which uses
three fMP4 segments and `init.mp4`. `poster.jpg` is a frame from the same clip.

CI uses the checked-in files and does not need FFmpeg.
