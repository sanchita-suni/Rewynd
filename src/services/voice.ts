import { VoiceRendering, VoiceService } from './types';
import { config } from '../config';

/**
 * MOCK VoiceService — a stable placeholder URL, no audio bytes. Used when Murf
 * is unconfigured or forced off; the card still renders (link only, no player).
 */
export class MockVoiceService implements VoiceService {
  async renderTriage(_triageSummary: string): Promise<VoiceRendering> {
    return {
      audioUrl: 'https://rewynd-sandbox.example/audio/triage-mock.mp3',
      isMock: true,
    };
  }
}

/**
 * REAL VoiceService — Murf TTS (spec §2.2). Renders the (spoken, ≤40-word) triage
 * summary to a ~15s clip and returns the hosted URL plus the raw bytes, so the
 * orchestrator can upload a native Slack audio player into the thread. Falls back
 * to the mock rendering on any error so the card always renders.
 */
export class MurfVoiceService implements VoiceService {
  private readonly fallback: VoiceService;

  constructor(fallback: VoiceService) {
    this.fallback = fallback;
  }

  async renderTriage(triageSummary: string): Promise<VoiceRendering> {
    try {
      const res = await fetch(config.murf.apiUrl, {
        method: 'POST',
        headers: {
          'api-key': config.murf.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          text: triageSummary,
          voiceId: config.murf.voiceId,
          format: 'MP3',
          channelType: 'MONO',
          sampleRate: 44100,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Murf HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const json: any = await res.json();
      const audioUrl: string | undefined = json?.audioFile ?? json?.audioUrl;
      const lengthSeconds: number | undefined = json?.audioLengthInSeconds ?? json?.audioLength;

      if (!audioUrl) throw new Error('Murf response had no audioFile URL');

      // Fetch the bytes so we can upload a native player (Murf URLs can expire).
      let audioData: Buffer | undefined;
      try {
        const audioRes = await fetch(audioUrl);
        if (audioRes.ok) {
          audioData = Buffer.from(await audioRes.arrayBuffer());
        }
      } catch {
        /* URL still works as a link even if the byte fetch fails */
      }

      console.log(
        `[Murf] ${lengthSeconds ? Math.round(lengthSeconds) + 's ' : ''}triage rendered` +
          `${audioData ? ` (${Math.round(audioData.length / 1024)} KB)` : ''}`,
      );
      return { audioUrl, audioData, contentType: 'audio/mpeg', lengthSeconds };
    } catch (err) {
      console.log(`[Murf] ERROR — ${(err as Error).message} → no audio (card renders text-only)`);
      return this.fallback.renderTriage(triageSummary);
    }
  }
}

// Selection: real Murf when configured & not forced to mocks; else mock.
export const voiceService: VoiceService =
  !config.useMocks && config.murf.apiKey && config.murf.apiKey !== 'your-murf-api-key'
    ? new MurfVoiceService(new MockVoiceService())
    : new MockVoiceService();
