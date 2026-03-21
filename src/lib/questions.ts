export interface Question {
  question: string;
  options: [string, string, string, string];
  correct: number; // 0-indexed
}

export const questions: Question[] = [
  { question: "What is the closest star to Earth?", options: ["Proxima Centauri", "Sirius", "Alpha Centauri A", "Barnard's Star"], correct: 0 },
  { question: "Which planet has the most moons?", options: ["Jupiter", "Saturn", "Uranus", "Neptune"], correct: 1 },
  { question: "What is the name of the largest volcano in the solar system?", options: ["Mount Everest", "Olympus Mons", "Mauna Kea", "Tharsis Montes"], correct: 1 },
  { question: "How long does light from the Sun take to reach Earth?", options: ["4 minutes", "8 minutes", "12 minutes", "16 minutes"], correct: 1 },
  { question: "What is a pulsar?", options: ["A dying star", "A rotating neutron star", "A black hole", "A red giant"], correct: 1 },
  { question: "Which galaxy is nearest to the Milky Way?", options: ["Andromeda", "Triangulum", "Canis Major Dwarf", "Sagittarius Dwarf"], correct: 2 },
  { question: "What causes a solar eclipse?", options: ["Earth blocks the Sun", "Moon blocks the Sun", "Venus transits", "Solar flares"], correct: 1 },
  { question: "What is the Kuiper Belt?", options: ["Asteroid belt near Mars", "Ring of icy bodies beyond Neptune", "A nebula", "Saturn's rings"], correct: 1 },
  { question: "Which spacecraft first landed on Mars?", options: ["Viking 1", "Curiosity", "Spirit", "Opportunity"], correct: 0 },
  { question: "What is dark matter?", options: ["Black holes", "Invisible matter affecting gravity", "Antimatter", "Radiation"], correct: 1 },
  { question: "How old is the universe approximately?", options: ["10 billion years", "13.8 billion years", "15 billion years", "20 billion years"], correct: 1 },
  { question: "What is the Great Red Spot?", options: ["A volcano on Mars", "A storm on Jupiter", "A crater on Mercury", "A nebula"], correct: 1 },
  { question: "Which element is most abundant in the Sun?", options: ["Helium", "Hydrogen", "Carbon", "Oxygen"], correct: 1 },
  { question: "What is the event horizon?", options: ["Edge of the universe", "Boundary of a black hole", "Start of a galaxy", "Solar system edge"], correct: 1 },
  { question: "Who first proposed the heliocentric model?", options: ["Galileo", "Copernicus", "Kepler", "Newton"], correct: 1 },
  { question: "What is a supernova?", options: ["Star birth", "Star explosion", "Planet collision", "Galaxy merger"], correct: 1 },
  { question: "Which planet rotates on its side?", options: ["Venus", "Neptune", "Uranus", "Saturn"], correct: 2 },
  { question: "What is the Chandrasekhar limit?", options: ["Max mass of a white dwarf", "Speed of light", "Size of the universe", "Black hole radius"], correct: 0 },
  { question: "What are quasars?", options: ["Small stars", "Active galactic nuclei", "Planets", "Comets"], correct: 1 },
  { question: "Which moon has a subsurface ocean?", options: ["Phobos", "Titan", "Europa", "Deimos"], correct: 2 },
  { question: "What is redshift?", options: ["Star color change", "Light stretching from moving objects", "Sunset effect", "Laser phenomenon"], correct: 1 },
  { question: "How many AU is Earth from the Sun?", options: ["0.5", "1", "1.5", "2"], correct: 1 },
  { question: "What powers the Sun?", options: ["Chemical combustion", "Nuclear fission", "Nuclear fusion", "Gravitational energy"], correct: 2 },
  { question: "Which planet has the shortest day?", options: ["Mercury", "Earth", "Jupiter", "Mars"], correct: 2 },
  { question: "What is cosmic microwave background radiation?", options: ["Radio signals from aliens", "Afterglow of the Big Bang", "Solar wind", "X-rays from black holes"], correct: 1 },
];

export const TIMER_DURATION = 45;
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
