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
  'Keep the result within the range a competent photographer could achieve on location. When in doubt, do less.',
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

const SKY: Record<string, { sky: string; mood: string }> = {
  Nacht: {
    sky: 'a deep blue-hour night sky, not pitch black, with subtle stars and no artificial moon',
    mood: 'Warm interior light glowing from the windows, exterior fixtures on, plausible reflections and long soft shadows.',
  },
  Sundown: {
    sky: 'a natural sundown sky with a soft orange-to-deep-blue gradient and thin wispy clouds',
    mood: 'Low warm ambient glow, long authentic shadows, calm and welcoming.',
  },
  Sunrise: {
    sky: 'a fresh early-morning sky with a clear horizon and light clouds catching the first sun',
    mood: 'Crisp warm directional light from a low angle, bright and clean.',
  },
  Mittags: {
    sky: 'a clear blue midday sky with a few small fair-weather cumulus clouds',
    mood: 'Bright natural daylight, high but realistic contrast, short shadows.',
  },
  Nachmittags: {
    sky: 'a friendly afternoon sky with soft natural clouds',
    mood: 'Warm golden directional light, inviting, medium-length shadows.',
  },
  Original: {
    sky: 'a realistic clear blue sky with soft white clouds',
    mood: 'Friendly bright sunny atmosphere without an over-processed look.',
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
    lines.push(`Atmosphere: ${preset.mood}`);
  } else {
    lines.push('Sky and weather: keep exactly as in the source image. Do not replace the sky.');
  }

  if (o.verbessereHelligkeitKontrast) {
    lines.push('Exposure: lift shadows, recover blown highlights, set a clean black point.');
  }
  if (o.verbessereFarbe) {
    lines.push('Colour: neutral white balance, natural material-safe saturation, remove colour casts.');
  }
  if (o.fügeSonneMitLensflaresHinzu) {
    lines.push(
      'Sunlight: strong directional sunlight with one restrained, optically plausible lens flare ' +
      'originating from the actual sun position.'
    );
  } else if (o.fügeSonneHinzu) {
    lines.push(
      'Sunlight: add directional sunlight consistent with the shadow directions already visible in the source.'
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
    'Direct afternoon sunlight enters through the existing windows at an angle consistent with their ' +
    'position. It lands as clearly defined, bright pools on floor and furniture, with crisp shadow edges. ' +
    'Only those directly lit patches are warm. Walls, ceiling, textiles and furniture keep their original ' +
    'colour and neutral white balance everywhere else. No haze, no visible light rays, no golden wash ' +
    'over the room.',
  Subtil:
    'Soft even daylight from the windows. Gentle, low-contrast illumination with barely defined light ' +
    'pools and open shadows. Neutral white balance throughout.',
  ShallowSun:
    'Daylight with shallow penetration: defined light pools on the floor within roughly one to two metres ' +
    'of the windows, falling off quickly towards the back of the room, which stays in soft ambient light.',
  Normal:
    'Bright, balanced daylight. Readable light pools on the floor, soft realistic shadows, ' +
    'neutral white balance, open shadow detail.',
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
