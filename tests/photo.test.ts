import { describe, expect, it } from 'vitest';
import { deliveryFor, photoFileName, watermarkText } from '../src/ui/photo';

describe('photo', () => {
  it('names files after the subject and the local capture time', () => {
    expect(photoFileName('saturn', new Date(2026, 9, 23, 14, 5, 9))).toBe('gesture-space-explorer_saturn_2026-10-23_14-05-09.png');
  });

  it('watermarks with the app name and the planet', () => {
    expect(watermarkText('土星')).toBe('Gesture Space Explorer · 土星');
  });

  it('offers the share sheet only on phones that can share files', () => {
    expect(deliveryFor({ mobile: true, canShareFiles: true })).toBe('share-button');
    expect(deliveryFor({ mobile: true, canShareFiles: false })).toBe('download');
    expect(deliveryFor({ mobile: false, canShareFiles: true })).toBe('download');
  });
});
