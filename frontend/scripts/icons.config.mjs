// Which Phosphor icons the app uses, and in which weights. `npm run icons` turns this list into
// components/icons/generated.tsx. Only what is listed here ends up in the JavaScript bundle.
//
// Weights: regular (default), bold (small sizes), fill (active or status), duotone (picture tiles).

const R = ["regular"];
const RF = ["regular", "fill"];
const RD = ["regular", "duotone"];

export const ICONS = {
  // Shell and navigation
  house: RF,
  path: RF,
  "file-magnifying-glass": RF,
  lifebuoy: RF,
  "dots-three-outline": RF,
  "caret-left": ["bold"],
  "caret-right": ["bold"],
  "caret-down": ["bold"],
  "arrow-left": ["bold"],
  x: ["bold"],
  siren: ["bold", "fill"],
  gear: R,
  translate: R,
  moon: RD,
  sun: RD,
  "text-aa": R,
  "sign-in": R,
  "sign-out": R,
  "user-circle": R,
  "door-open": ["bold"],

  // Onboarding and picture tiles
  briefcase: RD,
  "graduation-cap": RD,
  compass: RD,
  "map-pin": RD,
  "airplane-tilt": ["regular", "fill", "duotone"],
  airplane: ["fill"],
  "globe-hemisphere-east": RD,
  "hand-coins": RD,
  files: RD,
  "identification-card": RD,
  "identification-badge": RD,
  "magnifying-glass": ["regular", "bold"],
  "chats-circle": RD,
  vault: RD,
  "users-three": RD,
  scales: RD,
  "book-open-text": RD,
  "list-checks": RD,
  calculator: RD,
  exam: RD,

  // Status shapes
  circle: R,
  "circle-half": ["fill"],
  "check-circle": RF,
  check: ["bold"],
  warning: RF,
  "warning-octagon": RF,
  "x-circle": RF,
  "minus-circle": R,
  "hand-palm": ["bold", "fill"],
  info: RF,
  "seal-check": RF,
  "pencil-simple-line": R,
  flask: R,
  robot: R,
  hourglass: R,
  "calendar-blank": RD,
  "calendar-plus": R,
  clock: R,

  // Who does a step
  user: RF,
  buildings: R,
  bank: R,
  handshake: R,

  // Actions
  "speaker-high": RF,
  stop: ["fill"],
  microphone: RF,
  "microphone-slash": R,
  camera: R,
  image: R,
  "upload-simple": R,
  "download-simple": R,
  copy: R,
  "share-network": R,
  "arrow-square-out": ["regular", "bold"],
  "link-simple": R,
  trash: R,
  plus: ["bold"],
  phone: RF,
  "whatsapp-logo": RF,
  "arrow-clockwise": ["bold"],
  question: RD,
  "eye-slash": R,
  "lock-key": R,
  "shield-check": RD,
  "shield-warning": RD,
  "wifi-slash": R,
  "device-mobile": RD,
  "cloud-check": R,

  // Content
  "file-text": RD,
  stamp: RD,
  certificate: RD,
  coins: RD,
  receipt: RD,
  "first-aid-kit": RD,
  stethoscope: RD,
  fingerprint: RD,
  "suitcase-rolling": RD,
  "airplane-takeoff": RD,
  "airplane-landing": RD,
  "house-line": RD,
  plant: RD,
  "map-trifold": RD,
  megaphone: RD,
  "paper-plane-tilt": R,
  "envelope-simple": R,
  star: RF,
  paperclip: R,

  // Assistant, interview practice and privacy
  "chat-circle-text": RD,
  "chalkboard-teacher": RD,
  waveform: ["bold"],
  keyboard: R,
  database: RD,
  prohibit: R,
  "users-four": RD,
  "cloud-slash": R,
  "cloud-arrow-down": R,
  "file-csv": R,
  "arrow-counter-clockwise": R,
  "user-gear": RD,
};

// Icons Phosphor does not have, drawn on the same 256 grid in the same line weight.
export const CUSTOM = {
  // A closed passport booklet: cover, a plain ring where an emblem would be, and two lines of print.
  // Deliberately no emblem, so it cannot be read as any country's passport.
  passport: {
    regular:
      '<path d="M192,24H72A24,24,0,0,0,48,48V208a24,24,0,0,0,24,24H192a16,16,0,0,0,16-16V40A16,16,0,0,0,192,24Zm0,192H72a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8H192ZM128,60a40,40,0,1,0,40,40A40,40,0,0,0,128,60Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,124Zm48,44a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,168Zm-16,28a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16h48A8,8,0,0,1,160,196Z"/>',
    duotone:
      '<path d="M72,32H200V224H72a16,16,0,0,1-16-16V48A16,16,0,0,1,72,32Z" opacity="0.2"/><path d="M192,24H72A24,24,0,0,0,48,48V208a24,24,0,0,0,24,24H192a16,16,0,0,0,16-16V40A16,16,0,0,0,192,24Zm0,192H72a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8H192ZM128,60a40,40,0,1,0,40,40A40,40,0,0,0,128,60Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,124Zm48,44a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,168Zm-16,28a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16h48A8,8,0,0,1,160,196Z"/>',
    fill:
      '<path d="M192,24H72A24,24,0,0,0,48,48V208a24,24,0,0,0,24,24H192a16,16,0,0,0,16-16V40A16,16,0,0,0,192,24ZM152,204H104a8,8,0,0,1,0-16h48a8,8,0,0,1,0,16Zm16-28H88a8,8,0,0,1,0-16h80a8,8,0,0,1,0,16Zm-40-36a40,40,0,1,1,40-40A40,40,0,0,1,128,140Zm24-40a24,24,0,1,1-24-24A24,24,0,0,1,152,100Z"/>',
  },
};
