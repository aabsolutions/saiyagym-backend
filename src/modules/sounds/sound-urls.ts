/**
 * Pure delivery-URL builders for rest-alarm sounds (no I/O, no SDK).
 * Cloudinary `af_22050` = audio frequency; it shrinks the wav that iOS needs for notification
 * sounds. (`ac_` is the audio CODEC, not the channel count — there is no mono parameter.)
 */
const WAV_TRANSFORMATION = 'af_22050';

function base(cloudName: string): string {
  return `https://res.cloudinary.com/${cloudName}/video/upload`;
}

/** iOS: notification sounds must be wav/aiff/caf. */
export function wavUrl(cloudName: string, publicId: string): string {
  return `${base(cloudName)}/${WAV_TRANSFORMATION}/${publicId}.wav`;
}

/** Android: small download, played from MediaStore. */
export function mp3Url(cloudName: string, publicId: string): string {
  return `${base(cloudName)}/${publicId}.mp3`;
}

/** Stable per-asset key (the uuid tail of the public id); channel/file names derive from it. */
export function assetKey(publicId: string): string {
  return publicId.slice(publicId.lastIndexOf('/') + 1);
}
