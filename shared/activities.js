// Built-in exercise list with MET values (metabolic equivalents), based on the
// Compendium of Physical Activities. Calories are an estimate:
//   kcal = MET x body weight (kg) x hours

export const ACTIVITIES = [
  { key: 'walk_slow', name: 'Walking, slow (3 km/h)', met: 2.8 },
  { key: 'walk', name: 'Walking, moderate (5 km/h)', met: 3.5 },
  { key: 'walk_brisk', name: 'Walking, brisk (6.5 km/h)', met: 5.0 },
  { key: 'bushwalk', name: 'Bushwalking / hiking', met: 6.0 },
  { key: 'run_8', name: 'Running, 8 km/h (7:30 per km)', met: 8.3 },
  { key: 'run_10', name: 'Running, 10 km/h (6:00 per km)', met: 9.8 },
  { key: 'run_12', name: 'Running, 12 km/h (5:00 per km)', met: 11.8 },
  { key: 'cycle_easy', name: 'Cycling, leisurely (under 16 km/h)', met: 4.0 },
  { key: 'cycle_mod', name: 'Cycling, moderate (19–22 km/h)', met: 8.0 },
  { key: 'cycle_hard', name: 'Cycling, vigorous (22–26 km/h)', met: 10.0 },
  { key: 'bike_stationary', name: 'Exercise bike, moderate', met: 6.8 },
  { key: 'swim_easy', name: 'Swimming, leisurely', met: 6.0 },
  { key: 'swim_laps', name: 'Swimming laps, vigorous', met: 9.8 },
  { key: 'weights', name: 'Weight training, general', met: 3.5 },
  { key: 'weights_hard', name: 'Weight training, vigorous', met: 6.0 },
  { key: 'hiit', name: 'HIIT / circuit training', met: 8.0 },
  { key: 'bodyweight', name: 'Bodyweight exercises (push-ups, sit-ups)', met: 3.8 },
  { key: 'yoga', name: 'Yoga', met: 2.5 },
  { key: 'pilates', name: 'Pilates', met: 3.0 },
  { key: 'stretch', name: 'Stretching', met: 2.3 },
  { key: 'aerobics', name: 'Aerobics class', met: 7.3 },
  { key: 'dance', name: 'Dancing', met: 5.0 },
  { key: 'elliptical', name: 'Elliptical trainer', met: 5.0 },
  { key: 'rowing', name: 'Rowing machine, moderate', met: 7.0 },
  { key: 'stairs', name: 'Stair climbing', met: 8.8 },
  { key: 'skipping', name: 'Skipping rope', met: 11.0 },
  { key: 'boxing', name: 'Boxing, bag work', met: 5.5 },
  { key: 'martial_arts', name: 'Martial arts', met: 10.3 },
  { key: 'tennis', name: 'Tennis', met: 7.3 },
  { key: 'squash', name: 'Squash', met: 7.3 },
  { key: 'badminton', name: 'Badminton', met: 5.5 },
  { key: 'basketball', name: 'Basketball', met: 6.5 },
  { key: 'netball', name: 'Netball', met: 7.0 },
  { key: 'soccer', name: 'Soccer', met: 7.0 },
  { key: 'afl', name: 'Australian rules football', met: 8.0 },
  { key: 'rugby', name: 'Rugby / touch football', met: 8.3 },
  { key: 'cricket', name: 'Cricket', met: 4.8 },
  { key: 'golf', name: 'Golf, walking', met: 4.3 },
  { key: 'surfing', name: 'Surfing', met: 3.0 },
  { key: 'kayak', name: 'Kayaking / paddling', met: 5.0 },
  { key: 'gardening', name: 'Gardening', met: 3.8 },
  { key: 'mowing', name: 'Mowing the lawn', met: 5.5 },
  { key: 'housework', name: 'Housework / cleaning', met: 3.3 },
  { key: 'kids', name: 'Playing with kids, active', met: 4.0 },
];

export function findActivity(key) {
  return ACTIVITIES.find((a) => a.key === key) || null;
}

/** Estimated energy burned (kcal) for an activity. */
export function exerciseKcal(met, weightKg, minutes) {
  if (!(met > 0) || !(weightKg > 0) || !(minutes > 0)) return 0;
  return met * weightKg * (minutes / 60);
}
