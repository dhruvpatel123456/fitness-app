// Body measurements that can be tracked on the Progress screen.

export const MEASUREMENT_KINDS = [
  { key: 'waist', label: 'Waist', unit: 'cm', min: 30, max: 300 },
  { key: 'chest', label: 'Chest', unit: 'cm', min: 30, max: 300 },
  { key: 'hips', label: 'Hips', unit: 'cm', min: 30, max: 300 },
  { key: 'thigh', label: 'Thigh', unit: 'cm', min: 15, max: 200 },
  { key: 'arm', label: 'Upper arm', unit: 'cm', min: 10, max: 150 },
  { key: 'neck', label: 'Neck', unit: 'cm', min: 15, max: 150 },
  { key: 'body_fat', label: 'Body fat', unit: '%', min: 2, max: 75 },
];

export function findMeasurementKind(key) {
  return MEASUREMENT_KINDS.find((k) => k.key === key) || null;
}
