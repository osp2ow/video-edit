import sys, subprocess, numpy as np
f = sys.argv[1]
w, h = map(int, subprocess.check_output(['ffprobe','-v','error','-select_streams','v','-show_entries','stream=width,height','-of','csv=p=0',f]).decode().strip().split(','))
raw = subprocess.check_output(['ffmpeg','-v','error','-i',f,'-vf','format=gray','-fps_mode','passthrough','-f','rawvideo','-'])
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w)
c = fr[:, h//2-10:h//2+10, w//2-10:w//2+10].mean(axis=(1,2))
idx = np.round(c * 219 / 255 / 8).astype(int) % 25
d = (np.diff(idx)) % 25
print('frames', len(idx), 'dup', int((d == 0).sum()), 'skip', int((d >= 2).sum()), 'seq', ''.join('.' if x == 1 else ('=' if x == 0 else str(min(x,9))) for x in d)[:200])
