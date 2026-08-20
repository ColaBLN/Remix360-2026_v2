import type { PromptStyle, TaskKind } from './providers/types';

export type Tageszeit =
  | 'Original' | 'Sunrise' | 'Mittags' | 'Nachmittags' | 'Sundown' | 'Nacht'
  | 'Normal' | 'Intensiv' | 'Subtil' | 'ShallowSun' | 'Digital Staging'
  // Fokus-Varianten des Detail-Moduls. Standen bisher nur im Service und
  // waren über die Oberfläche nicht erreichbar.
  | 'Design & Material' | 'Licht & Atmosphäre' | 'Möbel & Deko';

export type StagingMode = 'empty' | 'furnished';
export type RoomType =
  | 'Wohnzimmer' | 'Balkon' | 'Terrasse' | 'Schlafzimmer'
  | 'Küche' | 'Kinderzimmer' | 'Esszimmer' | 'Bad';
export type Jahreszeit = 'none' | 'winter' | 'fruehling' | 'sommer' | 'herbst';

export interface OptimizationOptions {
  verbessereHelligkeitKontrast: boolean;
  verbessereFarbe: boolean;
  verbessereWetter: boolean;
  fügeSonneHinzu: boolean;
  fügeSonneMitLensflaresHinzu: boolean;
  verbessereRasen: boolean;
  entferneSchnee: boolean;
  jahreszeit?: Jahreszeit;
}

export const DEFAULT_OPTIONS: OptimizationOptions = {
  verbessereHelligkeitKontrast: true,
  verbessereFarbe: true,
  verbessereWetter: true,
  fügeSonneHinzu: true,
  fügeSonneMitLensflaresHinzu: false,
  verbessereRasen: true,
  entferneSchnee: false,
  jahreszeit: 'none',
};

export const SYSTEM_INSTRUCTION =
  'You are a professional architectural photo retoucher. Return only the edited image. ' +
  'Never return text, reasoning or metadata. Never invent architecture that is not in the source.';

/**
 * Gilt für jede Aufgabe. Bisher stand das in acht Prompts leicht
 * unterschiedlich formuliert, wodurch die Grundtreue je nach Knopf variierte.
 */
const INVARIANTS = [
  'Do not alter building geometry, wall positions, window shapes, roof lines or room proportions.',
  'Do not change camera position, focal length or perspective.',
  'Do not add, remove or move structural elements.',
  'Do not add people, faces, licence plates, house numbers or readable signage.',
  'Preserve material identity: brick stays brick, render stays render, wood grain stays wood grain.',
  // Ohne diese Zeile legen die Modelle gern einen globalen Orange- oder
  // Sepiafilter über das ganze Bild. Genau das lässt Ergebnisse unecht wirken.
  'Do not apply a global colour grade, tint, filter or bloom to the whole frame. White stays white.',
  'Restraint applies to structure, materials and colour. It does not apply to lighting: ' +
    'the lighting improvement must be clearly visible when compared to the source image.',
  'Photorealistic result. No HDR halos, no oversaturation, no plastic sheen. It must read as a photograph.',
].join(' ');

function block(task: string, body: Array<string | false | undefined>): string {
  return [`Task: ${task}.`, ...body.filter(Boolean), `Constraints: ${INVARIANTS}`].join('\n');
}

/* ---------------------------------------------------------------- */
/* Jahreszeit                                                        */
/* ---------------------------------------------------------------- */

const SEASON: Record<Exclude<Jahreszeit, 'none'>, string> = {
  winter:
    'adjust existing trees, shrubs and leaves to a winter state: realistically bare branches, ' +
    'or existing foliage dusted with snow and frost',
  fruehling:
    'adjust existing trees and shrubs to early spring: fresh soft light-green buds and young foliage',
  sommer:
    'adjust existing trees, shrubs and lawn to full summer: dense, deep natural green foliage',
  herbst:
    'adjust existing foliage to autumn: yellow, deep orange and golden-red tones on the trees and shrubs already present',
};

function seasonLine(jahreszeit: Jahreszeit | undefined, isInterior: boolean): string | false {
  if (!jahreszeit || jahreszeit === 'none') return false;
  const where = isInterior
    ? 'in the outdoor view visible through windows and glass doors'
    : 'in the garden, planting and surroundings';
  return (
    `Season: ${SEASON[jahreszeit]}, ${where}. ` +
    'Change only the state and colour of vegetation that already exists. ' +
    'Do not add new plants, flower beds, snowbanks or decorative elements.'
  );
}

/* ---------------------------------------------------------------- */
/* Aussenaufnahme                                                    */
/* ---------------------------------------------------------------- */

interface SkyPreset {
  sky: string;
  /** Sonnenstand und Schattenverhalten – das eigentliche Unterscheidungsmerkmal. */
  light: string;
  /** Farbtemperatur in Kelvin. Ohne diese Angabe sahen alle Tageszeiten gleich aus. */
  kelvin: string;
  /** true, wenn die Szene keine direkte Sonne hat. */
  noSun?: boolean;
}

/**
 * Die Presets unterschieden sich früher nur in der Himmelsbeschreibung, und
 * die Farboption hat den Rest anschliessend wieder neutralisiert. Ergebnis:
 * Sonnenaufgang, Mittag und Nachmittag sahen praktisch identisch aus.
 * Jetzt trägt jede Tageszeit Sonnenhöhe, Schattenlänge und Farbtemperatur.
 */
const SKY: Record<string, SkyPreset> = {
  Nacht: {
    sky: 'a deep blue-hour night sky, not pitch black, with subtle stars and no moon',
    light:
      'The sun is below the horizon. There is no direct sunlight and no cast shadows from the sun. ' +
      'The building is lit by warm interior light glowing through the windows and by its exterior fixtures, ' +
      'which are switched on and pool light on the ground beneath them.',
    kelvin: 'Cool blue ambient light around 8000K, with warm 2700K pools at the light sources.',
    noSun: true,
  },
  Sundown: {
    sky: 'a sundown sky with an orange-to-deep-blue gradient and thin wispy clouds near the horizon',
    light:
      'The sun sits just above the horizon. Shadows are very long, stretching several times the height ' +
      'of the objects casting them, and run almost horizontally across the ground. Only the upper facade ' +
      'still catches direct light; the lower half is already in shade.',
    kelvin: 'Warm low-angle light around 2800K on the sunlit surfaces, cool blue shade elsewhere.',
  },
  Sunrise: {
    sky: 'a clear early-morning sky, pale towards the horizon, with light high clouds catching the first sun',
    light:
      'The sun is low in the east. Shadows are long and directional, the air reads clean and slightly cool. ' +
      'Grass and paving may still look damp. Contrast is gentle.',
    kelvin: 'Fresh light around 3500K on lit surfaces, distinctly cooler and cleaner than an evening scene.',
  },
  Mittags: {
    sky: 'a clear blue midday sky, deepest overhead, with a few small fair-weather cumulus clouds',
    light:
      'The sun is high overhead. Shadows are short, compact and fall almost directly beneath the objects ' +
      'casting them. Roof surfaces are bright, vertical facades comparatively less lit. Contrast is high ' +
      'with crisp shadow edges.',
    kelvin: 'Neutral daylight around 5500K. Whites read as white.',
  },
  Nachmittags: {
    sky: 'a friendly afternoon sky with soft scattered clouds',
    light:
      'The sun stands at roughly 30 to 40 degrees. Shadows are of medium length and clearly directional, ' +
      'about one to two times the height of the objects casting them. The facade facing the sun is ' +
      'noticeably brighter than the others.',
    kelvin: 'Slightly warm light around 4500K, gentler than midday but far from the orange of sundown.',
  },
  Original: {
    sky: 'a realistic clear blue sky with soft white clouds',
    light:
      'Pleasant daylight with directional sun and clearly defined but not harsh shadows.',
    kelvin: 'Neutral daylight around 5500K.',
  },
};

export function exteriorPrompt(tageszeit: Tageszeit, o: OptimizationOptions): string {
  const preset = SKY[tageszeit] ?? SKY.Original;
  const lines: Array<string | false> = [];

  // Jeder Schalter wirkt jetzt. Vorher landeten von sieben Optionen nur zwei
  // im Prompt, und "Beautiful weather, blue sky" stand fest verdrahtet drin –
  // der Himmel wurde also auch getauscht, wenn der Nutzer das abgewählt hatte.
  if (o.verbessereWetter) {
    lines.push(`Sky: replace with ${preset.sky}.`);
    lines.push(`Sun and shadows: ${preset.light}`);
    lines.push(`Colour temperature: ${preset.kelvin} This is the intended look of the chosen time of day, not an unwanted cast.`);
  } else {
    lines.push('Sky and weather: keep exactly as in the source image. Do not replace the sky.');
  }

  if (o.verbessereHelligkeitKontrast) {
    lines.push('Exposure: lift shadows, recover blown highlights, set a clean black point.');
  }
  if (o.verbessereFarbe) {
    // Früher stand hier pauschal "neutral white balance, remove colour casts".
    // Das hat die Farbstimmung von Sonnenaufgang, Dämmerung und Nacht wieder
    // eingeebnet, weshalb alle Tageszeiten ähnlich aussahen.
    lines.push(
      o.verbessereWetter
        ? 'Colour: clean, material-safe saturation. Keep the colour temperature stated above; do not neutralise it.'
        : 'Colour: neutral white balance, natural material-safe saturation, remove colour casts.'
    );
  }
  if (preset.noSun) {
    // Sonnenoptionen ergeben nachts keinen Sinn und würden dem Preset widersprechen.
  } else if (o.fügeSonneMitLensflaresHinzu) {
    lines.push(
      'Sunlight: strong direct sunlight with clearly brightened sunlit surfaces and defined shadows, ' +
      'plus one restrained, optically plausible lens flare originating from the actual sun position.'
    );
  } else if (o.fügeSonneHinzu) {
    lines.push(
      'Sunlight: the scene is lit by direct sunlight. Surfaces facing the sun are clearly brighter and cast ' +
      'defined shadows, consistent with the shadow directions already visible in the source.'
    );
  }
  if (o.verbessereRasen) {
    lines.push('Lawn and planting: healthy, evenly mown, natural green. No artificial turf look.');
  }

  // Schnee entfernen und Winter widersprechen sich – Schnee gewinnt.
  const snowWins = o.entferneSchnee;
  lines.push(
    snowWins
      ? 'Snow: remove all snow from ground, roof and vegetation. Replace with green lawn, clean paving and summer foliage.'
      : 'Snow: if snow is present in the source, keep it.'
  );
  if (!snowWins) lines.push(seasonLine(o.jahreszeit, false));

  return block('Real estate exterior retouching', lines);
}

/* ---------------------------------------------------------------- */
/* Innenaufnahme                                                     */
/* ---------------------------------------------------------------- */

const INTERIOR_LIGHT: Record<string, string> = {
  Intensiv:
    'Sunlight shines directly through the windows and is the defining feature of the image. It must land ' +
    'as large, bright, clearly defined pools of light on the floor and across the furniture, with crisp ' +
    'shadow edges. One faint, restrained shaft of light in the air is welcome where the beam is strongest. ' +
    'Only the directly sunlit patches are warm; every surface not in direct sun keeps its original colour ' +
    'and a neutral white balance. The room must read as markedly brighter and more inviting than the source.',
  Subtil:
    'Soft daylight fills the room through the windows. Gentle but clearly visible pools of light reach the ' +
    'floor, shadows stay open and low in contrast. The room must read as brighter and friendlier than the ' +
    'source, achieved through light rather than through a warm filter.',
  ShallowSun:
    'Sunlight enters through the windows and forms bright, clearly defined pools on the floor within roughly ' +
    'one to two metres of the glass, falling off towards the back of the room, which stays in soft ambient ' +
    'light. The lit zone near the windows must be unmistakable.',
  Normal:
    'Daylight enters through the windows and forms visible, clearly readable pools of light on the floor. ' +
    'The room must read as noticeably brighter, friendlier and more open than the source, with shadow ' +
    'detail lifted in corners and under furniture. The brightening comes from light, not from a warm tint.',
};

export function interiorPrompt(variation: Tageszeit, o: OptimizationOptions): string {
  return block('Interior lighting enhancement', [
    `Lighting: ${INTERIOR_LIGHT[variation] ?? INTERIOR_LIGHT.Normal}`,
    'Windows: keep the view through the windows plausible. Do not blow it out to pure white.',
    o.verbessereHelligkeitKontrast &&
      'Exposure: open up shadow detail in corners and under furniture without flattening the image.',
    o.verbessereFarbe &&
      'Colour: neutral white balance. Remove the cast typical of mixed tungsten and daylight.',
    seasonLine(o.jahreszeit, true),
  ]);
}

/* ---------------------------------------------------------------- */
/* Staging, Detail, Einzeloperationen                                */
/* ---------------------------------------------------------------- */

export function stagingPrompt(mode: StagingMode, roomType: RoomType): string {
  if (mode === 'empty') {
    return block('Digital decluttering', [
      'Remove all furniture, textiles, appliances and personal objects.',
      'Reconstruct floor, walls and skirting behind removed objects to match the surrounding material exactly.',
      'Keep permanently installed elements: radiators, doors, fitted kitchens, sanitary ware, built-in wardrobes.',
    ]);
  }
  return block(`Virtual staging as a ${roomType}`, [
    'Add contemporary, understated furniture at realistic scale for the visible room dimensions.',
    'Furniture must sit on the floor plane with contact shadows, matching existing light direction and colour temperature.',
    'Leave circulation space. Do not block doors, windows or radiators.',
    'No brand logos and no artwork with recognisable copyrighted imagery.',
  ]);
}

const DETAIL_FOCUS: Record<string, string> = {
  'Design & Material':
    'Focus on high-end material texture already present: wood grain, stone, tile, metal fittings or joinery.',
  'Licht & Atmosphäre':
    'Focus on an atmospheric corner with warm directional light, natural shadow and a shallow depth of field.',
  'Möbel & Deko':
    'Focus on an existing furniture piece or styling arrangement that reads as the most marketable detail.',
  Original:
    'Identify the single most marketable feature already present in the image and focus on it.',
};

export function detailPrompt(focus: Tageszeit): string {
  return block('Detail highlight crop', [
    DETAIL_FOCUS[focus] ?? DETAIL_FOCUS.Original,
    'Render only what is actually present in the source. Do not invent a new object.',
    'Keep the original colour palette, material quality and lighting character.',
  ]);
}

export function outdoorFurnishPrompt(): string {
  return block('Outdoor staging', [
    'Add restrained, realistic outdoor furniture appropriate to the visible surface: terrace, balcony or garden.',
    'Match the existing light direction and add correct contact shadows.',
  ]);
}

export function outpaintPrompt(): string {
  return block('Generative outpainting to a wider frame', [
    'Extend the canvas outwards. New areas must continue existing architecture, materials and light with no seam.',
    'Continue rooflines, fences, paving joints and window rhythm exactly as the geometry implies.',
    'If unsure what lies beyond the frame, extend ground and sky rather than inventing new buildings.',
  ]);
}

export function softenPrompt(): string {
  return block('Lighting cleanup', [
    'Soften hard shadow edges and reduce clipped specular hotspots.',
    'Keep the overall light direction and contrast ratio. This is a correction, not a relight.',
  ]);
}

export function customPrompt(userPrompt: string): string {
  return block('Targeted edit requested by the user', [
    `User request: "${userPrompt.trim()}"`,
    'Apply only the requested change. Leave everything else unchanged where possible.',
  ]);
}

/**
 * Kurzfassung für instruktionsbasierte Editoren wie FLUX Kontext und Seedream.
 *
 * Diese Modelle gewichten die ersten Sätze am stärksten. Bekommen sie unseren
 * vollständigen Constraint-Block, überwiegt das Verbotene die Anweisung und am
 * Bild passiert sichtbar nichts – genau das Verhalten, das im Eco-Modus auffiel.
 */
const CONCISE_INVARIANTS =
  'Keep architecture, perspective and materials unchanged. Photorealistic, no global colour tint.';

function condense(full: string): string {
  const instruction = full
    .split('\n')
    .filter(line => !line.startsWith('Constraints:'))
    .join(' ')
    .replace(/^Task:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Auf die ersten beiden Sätze kürzen, danach die Kurz-Randbedingungen.
  const sentences = instruction.split(/(?<=\.)\s+/).slice(0, 3).join(' ');
  return `${sentences} ${CONCISE_INVARIANTS}`;
}

export function buildPrompt(
  task: TaskKind,
  ctx: {
    tageszeit?: Tageszeit;
    options?: OptimizationOptions;
    roomType?: RoomType;
    userPrompt?: string;
    style?: PromptStyle;
  }
): string {
  const full = buildStructuredPrompt(task, ctx);
  return ctx.style === 'concise' ? condense(full) : full;
}

function buildStructuredPrompt(
  task: TaskKind,
  ctx: {
    tageszeit?: Tageszeit;
    options?: OptimizationOptions;
    roomType?: RoomType;
    userPrompt?: string;
  }
): string {
  const o = ctx.options ?? DEFAULT_OPTIONS;
  switch (task) {
    case 'exterior': return exteriorPrompt(ctx.tageszeit ?? 'Original', o);
    case 'interior': return interiorPrompt(ctx.tageszeit ?? 'Normal', o);
    case 'stage-empty': return stagingPrompt('empty', ctx.roomType ?? 'Wohnzimmer');
    case 'stage-furnish': return stagingPrompt('furnished', ctx.roomType ?? 'Wohnzimmer');
    case 'detail': return detailPrompt(ctx.tageszeit ?? 'Original');
    case 'outdoor-furnish': return outdoorFurnishPrompt();
    case 'outpaint': return outpaintPrompt();
    case 'soften': return softenPrompt();
    case 'custom': return customPrompt(ctx.userPrompt ?? '');
  }
}
