/**
 * Mock Abena AI voiceprint service (dev brief §3.5 / §4.2 `voiceEnrollments`).
 *
 * Mock rule (deterministic): a caller with no record is enrolled from their
 * first non-trivial speech sample; a known caller matches when the sample is
 * non-trivial. Acceptance threshold mirrors the brief: confidence > 0.85.
 * Swap this class for real Abena `createVoiceprint`/`verifyVoiceprint` calls
 * and store only the voiceprint ID — never raw audio (Data Protection Act).
 */
export const VERIFY_THRESHOLD = 0.85;

export interface VoiceprintRecord {
  voiceprintId: string;
  caller: string;
  language: string;
  enrolledAt: number;
  samples: number;
}

export type VerifyStatus = 'matched' | 'no-match' | 'not-enrolled';

export interface VerifyOutcome {
  status: VerifyStatus;
  confidence: number;
  accepted: boolean;
  record: VoiceprintRecord | null;
}

function isUsableSample(sample: string): boolean {
  return sample.trim().length >= 2;
}

export class MockVoiceprintStore {
  private readonly records = new Map<string, VoiceprintRecord>();
  private counter = 0;

  getByCaller(caller: string): VoiceprintRecord | null {
    return this.records.get(caller) ?? null;
  }

  enroll(caller: string, language: string): VoiceprintRecord {
    this.counter += 1;
    const record: VoiceprintRecord = {
      voiceprintId: `vp-mock-${this.counter}`,
      caller,
      language,
      enrolledAt: Date.now(),
      samples: 1,
    };
    this.records.set(caller, record);
    return record;
  }

  verify(caller: string, sample: string): VerifyOutcome {
    const record = this.records.get(caller) ?? null;
    if (!record) {
      return { status: 'not-enrolled', confidence: 0, accepted: false, record: null };
    }
    if (!isUsableSample(sample)) {
      return { status: 'no-match', confidence: 0.12, accepted: false, record };
    }
    const confidence = 0.97;
    return {
      status: 'matched',
      confidence,
      accepted: confidence > VERIFY_THRESHOLD,
      record,
    };
  }
}
