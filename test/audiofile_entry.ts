import { extractAudio, decodeVideoAudio } from '../src/audiofile';
import { decodeMono } from '../src/analysis';
(window as any).T = { extractAudio, decodeVideoAudio, decodeMono };
