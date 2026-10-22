import { assetKey, mp3Url, wavUrl } from './sound-urls';

const PUBLIC_ID = 'gymapp/prod/sounds/3f2b8c1e-5d4a-4b6e-9f10-1234567890ab';

describe('sound-urls', () => {
  it('wavUrl delivers a 22.05 kHz wav (iOS keeps the bundle of sounds small)', () => {
    expect(wavUrl('demo-cloud', PUBLIC_ID)).toBe(
      `https://res.cloudinary.com/demo-cloud/video/upload/af_22050/${PUBLIC_ID}.wav`,
    );
  });

  it('mp3Url delivers the asset as mp3 without extra transformations', () => {
    expect(mp3Url('demo-cloud', PUBLIC_ID)).toBe(
      `https://res.cloudinary.com/demo-cloud/video/upload/${PUBLIC_ID}.mp3`,
    );
  });

  it('assetKey is the id after the last slash (a replaced asset gets a new key)', () => {
    expect(assetKey(PUBLIC_ID)).toBe('3f2b8c1e-5d4a-4b6e-9f10-1234567890ab');
    expect(assetKey('plain-id')).toBe('plain-id');
  });
});
