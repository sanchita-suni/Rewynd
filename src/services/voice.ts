import { VoiceRendering, VoiceService } from './types';

/**
 * MOCK VoiceService.
 *
 * Real impl (later layer): Murf. Send the triage summary to Murf's TTS API and
 * return a hosted audio URL.
 *
 * For now it returns a stable placeholder audio URL. The Block Kit card renders
 * an audio section when a URL is present, so the voice affordance is demoable.
 */
export class MockVoiceService implements VoiceService {
  async renderTriage(_triageSummary: string): Promise<VoiceRendering> {
    return {
      audioUrl: 'https://echoops-sandbox.example/audio/triage-mock.mp3',
    };
  }
}

export const voiceService: VoiceService = new MockVoiceService();
