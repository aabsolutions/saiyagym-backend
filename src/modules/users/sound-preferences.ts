/**
 * Preference keys that hold a `rest_sounds._id`. All of them are validated on write (exists,
 * premium needs `premiumSounds`) and resolved to their EFFECTIVE value on read.
 */
export const SOUND_PREFERENCE_KEYS = [
  'restSoundId',
  'trainingReminderSoundId',
  'weighInSoundId',
] as const;

export type SoundPreferenceKey = (typeof SOUND_PREFERENCE_KEYS)[number];
