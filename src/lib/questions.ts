export interface Question {
  question: string;
  options: [string, string, string, string];
  correct: number; // 0-indexed
}

export const questions: Question[] = [
  { question: "Which constellation contains the Great Nebula (M42)?", options: ["Taurus", "Orion", "Perseus", "Cygnus"], correct: 1 },
  { question: "Which star is the brightest in the night sky?", options: ["Vega", "Polaris", "Sirius", "Rigel"], correct: 2 },
  { question: "Which of the following is NOT a type of galaxy?", options: ["Spiral", "Elliptical", "Irregular", "Radial"], correct: 3 },
  { question: "Which layer of the Sun is visible during a total solar eclipse?", options: ["Photosphere", "Chromosphere", "Corona", "Core"], correct: 2 },
  { question: "Which constellation is known as 'The Hunter'?", options: ["Leo", "Orion", "Scorpius", "Perseus"], correct: 1 },

  { question: "What is the boundary around a black hole beyond which nothing can escape?", options: ["Singularity", "Photon Sphere", "Event Horizon", "Accretion Disk"], correct: 2 },
  { question: "Which law explains the expansion of the universe?", options: ["Doppler Effect", "Hubble’s Law", "Kepler’s Law", "Newton’s Law"], correct: 1 },
  { question: "If one star shows redshift and another blueshift, what does it mean?", options: ["One is hotter", "One is larger", "One is moving away, the other toward us", "One is older"], correct: 2 },
  { question: "Why don’t we observe parallax shifts easily for distant stars?", options: ["Stars don’t move", "Telescopes are weak", "Distances are extremely large", "Light bends"], correct: 2 },
  { question: "Two stars have same temperature but one is brighter. Why?", options: ["It is closer", "It is older", "It is moving faster", "It has more planets"], correct: 0 },

  { question: "If the Sun disappeared, when would Earth notice?", options: ["Immediately", "After 8 minutes", "After 1 day", "After 1 year"], correct: 1 },
  { question: "Which constellation is known as 'The Swan'?", options: ["Lyra", "Cygnus", "Aquila", "Pegasus"], correct: 1 },
  { question: "Why is Polaris useful for navigation?", options: ["It is brightest", "It stays nearly fixed", "It rotates fastest", "It is closest"], correct: 1 },
  { question: "Which law relates orbital period and distance from the Sun?", options: ["Newton’s First Law", "Kepler’s First Law", "Kepler’s Second Law", "Kepler’s Third Law"], correct: 3 },
  { question: "What happens to constellations over millions of years?", options: ["Stay same", "Shift slightly", "Completely change shapes", "Disappear"], correct: 2 },

  { question: "Irregular blinking of a star is LEAST likely caused by?", options: ["Atmospheric distortion", "Instrument error", "Alien signal", "Dust interference"], correct: 2 },
  { question: "Which situation increases redshift?", options: ["Galaxy moving toward us", "Galaxy moving away faster", "Galaxy cooling", "Galaxy shrinking"], correct: 1 },
  { question: "What does the Drake Equation estimate?", options: ["Life probability on one planet", "Number of communicative civilizations", "Total habitable planets", "Interstellar travel likelihood"], correct: 1 },
  { question: "If a blue and red star appear equally bright, which is farther?", options: ["Blue star", "Red star", "Same distance", "Cannot determine"], correct: 0 },
  { question: "If light speed were infinite, what would change?", options: ["Star colors", "We’d see stars in real-time", "Gravity disappears", "Constellations vanish"], correct: 1 },

  { question: "Strongest evidence for universe expansion?", options: ["Star brightness", "Galaxy redshift", "Constellation motion", "Planet orbits"], correct: 1 },
  { question: "If a star moves perpendicular to us, what do we observe?", options: ["Redshift", "Blueshift", "No shift", "Brightness increase"], correct: 2 },
  { question: "From the Moon, how would constellations appear?", options: ["Completely different", "Same but clearer", "Invisible", "Rotating faster"], correct: 1 },
  { question: "What is panspermia?", options: ["Planet formation", "Life on every planet", "Life spreading via space", "Artificial life creation"], correct: 2 },
  { question: "If a star becomes 4× farther, brightness becomes?", options: ["2× dimmer", "4× dimmer", "8× dimmer", "16× dimmer"], correct: 3 },
];

export const TIMER_DURATION = 30;
export const POINTS_CORRECT = 30;
export const POINTS_WRONG = -40;
export const COST_FREEZE = 40;
export const COST_SHIELD = 30;
export const COST_SKIP = 0;
export const MAX_SKIPS = 5;
export const FREEZE_DURATION_SECONDS = 45;
export const FREEZE_COOLDOWN_SECONDS = 90;
export const SHIELD_DURATION_SECONDS = 30;
export const SHIELD_COOLDOWN_SECONDS = 45;
