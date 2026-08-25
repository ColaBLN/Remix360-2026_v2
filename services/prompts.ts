import type { PromptStyle, TaskKind } from './providers/types';

/**
 * Fassung der Prompt-Bibliothek. Wird an jedem Ergebnis mitgeschrieben.
 *
 * Ohne diesen Stempel liess sich nicht rekonstruieren, mit welcher Fassung ein
 * Bild entstanden ist – bei einer App, deren Qualität fast vollständig an den
 * Prompts hängt, ist das die eigentliche Qualitätssicherung.
 *
 * BEI JEDER PROMPT-ÄNDERUNG HOCHZÄHLEN.
 */
export const PROMPT_VERSION = '2026.08.25-d';

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
  /**
   * Spitzlichter vor dem Upload rechnerisch herunterziehen.
   * Kein Prompt, sondern ein Canvas-Schritt – siehe utils/tone.ts.
   */
  glanzDaempfen?: boolean;
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
  glanzDaempfen: true,
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
  'Do not apply an arbitrary filter or bloom to the whole frame. Any overall colour cast must come from the stated time of day, nothing else.',
  'Restraint applies to structure, materials and colour. It does not apply to lighting: ' +
    'the lighting improvement must be clearly visible when compared to the source image.',
  'No clipped highlights: every bright area must retain texture and detail. Nothing burns out to pure white.',
  'Photorealistic result. No HDR halos, no oversaturation, no plastic sheen. It must read as a photograph.',
].join(' ');

const CONCISE_TAIL =
  'Keep architecture, perspective and materials unchanged. Photorealistic, no arbitrary filters. ' +
  'No blown-out highlights: sunlit areas keep their texture, glossy surfaces stay matte, nothing burns to white.';

/**
 * Eine Anweisung in zwei Längen.
 *
 * Frühere Fassung hat für instruktionsbasierte Modelle den fertigen Prompt
 * nach drei Sätzen abgeschnitten. Dabei fielen genau die Anweisungen weg, die
 * der Nutzer angeklickt hatte — Belichtung, Rasen, Schnee, Jahreszeit —, und
 * übrig blieb die Himmelsbeschreibung. Deshalb bewirkte das HD-Modell bei
 * Außenaufnahmen kaum etwas.
 *
 * Kurz heisst jetzt: knapper formuliert, aber inhaltlich vollständig.
 */
type Line = string | [full: string, short: string] | false | undefined;

interface PromptSpec {
  task: string;
  taskShort?: string;
  instructions: Line[];
}

function render(spec: PromptSpec, style: PromptStyle): string {
  const lines = spec.instructions.filter(Boolean) as Array<string | [string, string]>;

  if (style === 'concise') {
    // Leere Kurzfassungen bedeuten: in der Kurzform bereits mit abgedeckt.
    const body = lines.map(l => (Array.isArray(l) ? l[1] : l)).filter(Boolean);
    return [`${spec.taskShort ?? spec.task}.`, ...body, CONCISE_TAIL].join(' ');
  }
  const body = lines.map(l => (Array.isArray(l) ? l[0] : l));
  return [`Task: ${spec.task}.`, ...body, `Constraints: ${INVARIANTS}`].join('\n');
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

function seasonLine(jahreszeit: Jahreszeit | undefined, isInterior: boolean): Line {
  if (!jahreszeit || jahreszeit === 'none') return false;
  const where = isInterior
    ? 'in the outdoor view visible through windows and glass doors'
    : 'in the garden, planting and surroundings';
  return [
    `Season: ${SEASON[jahreszeit]}, ${where}. ` +
      'Change only the state and colour of vegetation that already exists. ' +
      'Do not add new plants, flower beds, snowbanks or decorative elements.',
    `Season: ${SEASON[jahreszeit]} ${where}, changing only vegetation that already exists.`,
  ];
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
  /** Alles in einem Satz, für instruktionsbasierte Modelle. */
  short: string;
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
    short:
      'Set the scene at blue hour: deep blue sky, no sunlight or sun shadows, warm 2700K light glowing from the windows and exterior lamps switched on.',
  },
  Sundown: {
    sky: 'a sundown sky with an orange-to-deep-blue gradient and thin wispy clouds near the horizon',
    light:
      'The sun sits just above the horizon. Shadows are very long, stretching several times the height ' +
      'of the objects casting them, and run almost horizontally across the ground. Only the upper facade ' +
      'still catches direct light; the lower half is already in shade.',
    kelvin: 'Warm low-angle light around 2800K on the sunlit surfaces, cool blue shade elsewhere.',
    short:
      'Set the scene at sundown: orange-to-blue sky, sun just above the horizon, very long near-horizontal shadows, warm 2800K on lit surfaces.',
  },
  Sunrise: {
    sky: 'a clear early-morning sky, pale towards the horizon, with light high clouds catching the first sun',
    light:
      'The sun is low in the east. Shadows are long and directional, the air reads clean and slightly cool. ' +
      'Grass and paving may still look damp. Contrast is gentle.',
    kelvin: 'Fresh light around 3500K on lit surfaces, distinctly cooler and cleaner than an evening scene.',
    short:
      'Set the scene at early morning: pale clear sky, low eastern sun, long directional shadows, fresh 3500K light, gentle contrast.',
  },
  Mittags: {
    sky: 'a clear blue midday sky, deepest overhead, with a few small fair-weather cumulus clouds',
    light:
      'The sun is high overhead. Shadows are short, compact and fall almost directly beneath the objects ' +
      'casting them. Roof surfaces are bright, vertical facades comparatively less lit. Contrast is high ' +
      'with crisp shadow edges.',
    kelvin: 'Neutral daylight around 5500K. Whites read as white.',
    short:
      'Set the scene at midday: deep blue sky with small cumulus, sun overhead, short compact shadows directly beneath objects, neutral 5500K, crisp contrast.',
  },
  Nachmittags: {
    sky: 'a friendly afternoon sky with soft scattered clouds',
    light:
      'The sun stands at roughly 30 to 40 degrees. Shadows are of medium length and clearly directional, ' +
      'about one to two times the height of the objects casting them. The facade facing the sun is ' +
      'noticeably brighter than the others.',
    kelvin: 'Slightly warm light around 4500K, gentler than midday but far from the orange of sundown.',
    short:
      'Set the scene in the afternoon: soft scattered clouds, sun at 30-40 degrees, medium directional shadows, slightly warm 4500K.',
  },
  Original: {
    sky: 'a realistic clear blue sky with soft white clouds',
    light:
      'Pleasant daylight with directional sun and clearly defined but not harsh shadows.',
    kelvin: 'Neutral daylight around 5500K.',
    short:
      'Pleasant sunny day: clear blue sky with soft clouds, directional sun, defined but not harsh shadows, neutral 5500K.',
  },
};

export function exteriorPrompt(
  tageszeit: Tageszeit,
  o: OptimizationOptions,
  style: PromptStyle
): string {
  const preset = SKY[tageszeit] ?? SKY.Original;
  const lines: Line[] = [];

  if (o.verbessereWetter) {
    lines.push([`Sky: replace with ${preset.sky}.`, preset.short]);
    lines.push([`Sun and shadows: ${preset.light}`, '']);
    lines.push([
      `Colour temperature: ${preset.kelvin} This is the intended look of the chosen time of day, not an unwanted cast.`,
      '',
    ]);
  } else {
    lines.push([
      'Sky and weather: keep exactly as in the source image. Do not replace the sky.',
      'Keep the existing sky and weather unchanged.',
    ]);
  }

  if (o.verbessereHelligkeitKontrast) {
    lines.push([
      'Exposure: lift shadows, recover blown highlights, set a clean black point.',
      'Lift shadows and recover blown highlights.',
    ]);
  }
  if (o.verbessereFarbe) {
    lines.push(
      o.verbessereWetter
        ? [
            'Colour: clean, material-safe saturation. Keep the colour temperature stated above; do not neutralise it.',
            'Clean natural saturation, keeping the stated colour temperature.',
          ]
        : [
            'Colour: neutral white balance, natural material-safe saturation, remove colour casts.',
            'Neutral white balance, natural saturation.',
          ]
    );
  }

  if (preset.noSun) {
    // Sonnenoptionen ergeben nachts keinen Sinn und würden dem Preset widersprechen.
  } else if (o.fügeSonneMitLensflaresHinzu) {
    lines.push([
      'Sunlight: strong direct sunlight with clearly brightened sunlit surfaces and defined shadows, ' +
        'plus one restrained, optically plausible lens flare originating from the actual sun position.',
      'Strong direct sunlight with defined shadows and one subtle lens flare from the sun position.',
    ]);
  } else if (o.fügeSonneHinzu) {
    lines.push([
      'Sunlight: the scene is lit by direct sunlight. Surfaces facing the sun are clearly brighter and cast ' +
        'defined shadows, consistent with the shadow directions already visible in the source.',
      'Light the scene with direct sun: sunlit faces clearly brighter, shadows defined.',
    ]);
  }

  if (o.verbessereRasen) {
    lines.push([
      'Lawn and planting: healthy, evenly mown, natural green. No artificial turf look.',
      'Lawn healthy and evenly green, not artificial.',
    ]);
  }

  const snowWins = o.entferneSchnee;
  lines.push(
    snowWins
      ? [
          'Snow: remove all snow from ground, roof and vegetation. Replace with green lawn, clean paving and summer foliage.',
          'Remove all snow; green lawn, clean paving, summer foliage instead.',
        ]
      : ['Snow: if snow is present in the source, keep it.', 'Keep any snow that is present.']
  );
  if (!snowWins) lines.push(seasonLine(o.jahreszeit, false));

  return render(
    { task: 'Real estate exterior retouching', taskShort: 'Retouch this real estate exterior photo', instructions: lines },
    style
  );
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
    'and a neutral white balance. The lit pools show the floor texture clearly and never clip to white. ' +
    'The room must read as markedly brighter and more inviting than the source.',
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
    'The lit pools keep the floor texture clearly visible and never clip to white. The room must read as ' +
    'noticeably brighter, friendlier and more open than the source, with shadow detail lifted in corners ' +
    'and under furniture. The brightening comes from light, not from a warm tint.',
};

export function interiorPrompt(
  variation: Tageszeit,
  o: OptimizationOptions,
  style: PromptStyle
): string {
  return render({
    task: 'Interior lighting enhancement',
    taskShort: 'Improve the lighting in this interior photo',
    instructions: [
      `Lighting: ${INTERIOR_LIGHT[variation] ?? INTERIOR_LIGHT.Normal}`,
      // Steht bewusst direkt hinter der Beleuchtung: es ist deren wichtigste
      // Einschränkung. Weiter hinten im Prompt ging es unter.
      // Formuliert als Entfernungs-Auftrag – das Modell gibt den Glanz aus dem
      // Original sonst originalgetreu wieder, was formal richtig, aber
      // unverkäuflich ist.
      o.glanzDaempfen
        ? [
            'The input image has already had its highlights pulled down, so bright floor areas arrive as ' +
              'light grey rather than pure white. Paint the full wood grain, plank joints, tile grout or ' +
              'carpet texture back into those grey areas at the same contrast as the rest of the floor, ' +
              'and keep them matte. Do not brighten them back towards white.',
            'Bright floor areas arrive as light grey: paint the full wood grain back into them, matte, ' +
              'and do not brighten them towards white.',
          ]
        : [
        'CRITICAL — remove glare: wherever the source shows hard specular glare, a mirror-like sheen or a ' +
          'burnt-out white patch on the floor, worktops, glass or polished surfaces, remove it. Repaint ' +
          'those areas as an evenly lit matte surface. Inside every sunlit patch the wood grain, plank ' +
          'joints, tile grout or carpet texture must be fully legible, at the same contrast as the ' +
          'unlit part of the same floor. A varnished parquet must read as oiled, not as lacquered. ' +
          'The brightest point in the room must still hold visible detail.',
        'Remove all mirror-like glare and burnt-out white patches from floors and polished surfaces; ' +
          'wood grain stays clearly visible inside sunlit areas, matte not lacquered.',
      ],
      'Windows: keep the view through the windows plausible. Do not blow it out to pure white.',
      o.verbessereHelligkeitKontrast &&
        'Exposure: open up shadow detail in corners and under furniture without flattening the image.',
      o.verbessereFarbe &&
        'Colour: neutral white balance. Remove the cast typical of mixed tungsten and daylight.',
      seasonLine(o.jahreszeit, true),
    ],
  }, style);
}

/* ---------------------------------------------------------------- */
/* Staging, Detail, Einzeloperationen                                */
/* ---------------------------------------------------------------- */

export function stagingPrompt(mode: StagingMode, roomType: RoomType, style: PromptStyle): string {
  if (mode === 'empty') {
    return render({ task: 'Digital decluttering', instructions: [
      'Remove all furniture, textiles, appliances and personal objects.',
      'Reconstruct floor, walls and skirting behind removed objects to match the surrounding material exactly.',
      'Keep permanently installed elements: radiators, doors, fitted kitchens, sanitary ware, built-in wardrobes.',
    ] }, style);
  }
  return render({ task: `Virtual staging as a ${roomType}`, instructions: [
    'Add contemporary, understated furniture at realistic scale for the visible room dimensions.',
    'Furniture must sit on the floor plane with contact shadows, matching existing light direction and colour temperature.',
    'Leave circulation space. Do not block doors, windows or radiators.',
    'No brand logos and no artwork with recognisable copyrighted imagery.',
  ] }, style);
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

export function detailPrompt(focus: Tageszeit, style: PromptStyle): string {
  return render({ task: 'Detail highlight crop', instructions: [
    DETAIL_FOCUS[focus] ?? DETAIL_FOCUS.Original,
    'Render only what is actually present in the source. Do not invent a new object.',
    'Keep the original colour palette, material quality and lighting character.',
  ] }, style);
}

export function outdoorFurnishPrompt(style: PromptStyle): string {
  return render({ task: 'Outdoor staging', instructions: [
    'Add restrained, realistic outdoor furniture appropriate to the visible surface: terrace, balcony or garden.',
    'Match the existing light direction and add correct contact shadows.',
  ] }, style);
}

export function outpaintPrompt(style: PromptStyle): string {
  return render({ task: 'Generative outpainting to a wider frame', instructions: [
    'Extend the canvas outwards. New areas must continue existing architecture, materials and light with no seam.',
    'Continue rooflines, fences, paving joints and window rhythm exactly as the geometry implies.',
    'If unsure what lies beyond the frame, extend ground and sky rather than inventing new buildings.',
  ] }, style);
}

export function softenPrompt(style: PromptStyle): string {
  return render({ task: 'Lighting cleanup', instructions: [
    'Soften hard shadow edges and reduce clipped specular hotspots.',
    'Keep the overall light direction and contrast ratio. This is a correction, not a relight.',
  ] }, style);
}

/**
 * Einzweck-Durchgang gegen Glanz.
 *
 * Bewusst ohne Beleuchtungs-, Farb- oder Belichtungsanweisungen: Steht die
 * Glanz-Regel zwischen zehn anderen Anweisungen, geht sie unter. Allein
 * stehend ist sie die Aufgabe.
 */
export function deglarePrompt(style: PromptStyle): string {
  return render({
    task: 'Remove specular glare from floors and polished surfaces',
    taskShort: 'Remove the glare from the floor',
    instructions: [
      [
        'Find every area where light reflects off the floor, worktops, glass or polished surfaces as a ' +
          'hard bright patch, a mirror-like sheen or a washed-out pale zone. Repaint each of those areas ' +
          'as ordinary, evenly lit floor: continue the wood grain, plank joints, tile grout or carpet ' +
          'texture straight through the patch, matching the direction, scale, colour and contrast of the ' +
          'same floor immediately next to it. The floor must look uniformly matte, as if oiled rather ' +
          'than lacquered.',
        'Repaint every bright reflective patch on the floor as ordinary matte floor, continuing the wood ' +
          'grain straight through it at the same colour and contrast as the surrounding floor.',
      ],
      [
        'Keep the overall brightness of the room exactly as it is. Do not relight, do not change the ' +
          'colour temperature, do not touch walls, ceiling, windows or furniture. This is a local ' +
          'retouch of reflective surfaces only.',
        'Keep room brightness and colour unchanged; touch only the reflective surfaces.',
      ],
      [
        'A soft, gentle indication of where daylight falls may remain, but without any hotspot, ' +
          'without clipping to white and without a mirror effect.',
        'A soft hint of daylight may remain, but no hotspot and no mirror effect.',
      ],
    ],
  }, style);
}

export function customPrompt(userPrompt: string, style: PromptStyle): string {
  return render({ task: 'Targeted edit requested by the user', instructions: [
    `User request: "${userPrompt.trim()}"`,
    'Apply only the requested change. Leave everything else unchanged where possible.',
  ] }, style);
}

/**
 * Automatik: das Modell entscheidet selbst, ob es ein Innen- oder Außenbild ist.
 *
 * Bewusst in einem einzigen Aufruf statt mit vorgeschalteter Klassifizierung –
 * das spart eine zweite Abrechnung pro Bild. Die Entscheidungsregel steht
 * zuerst, weil Bildmodelle die vorderen Sätze am stärksten gewichten.
 */
const INTERIOR_TAGESZEITEN: Tageszeit[] = ['Normal', 'Intensiv', 'Subtil', 'ShallowSun'];

export function autoPrompt(
  tageszeit: Tageszeit,
  o: OptimizationOptions,
  style: PromptStyle
): string {
  // Die Tageszeit gehört je nach Erkennung in den einen oder anderen Zweig.
  // Eine Innenraum-Variante wie "Intensive Sonne" würde im Aussen-Zweig
  // sonst auf das Standard-Preset fallen und umgekehrt.
  const isInteriorVariant = INTERIOR_TAGESZEITEN.includes(tageszeit);
  const exterior = exteriorPrompt(isInteriorVariant ? 'Original' : tageszeit, o, 'concise')
    .replace(CONCISE_TAIL, '').trim();
  const interior = interiorPrompt(isInteriorVariant ? tageszeit : 'Normal', o, 'concise')
    .replace(CONCISE_TAIL, '').trim();

  return render({
    task: 'Real estate photo enhancement with automatic scene detection',
    taskShort: 'Enhance this real estate photo',
    instructions: [
      [
        'First decide from the image alone whether this photograph was taken indoors or outdoors. ' +
          'A view of a building from outside, a garden, a facade, a roof or a street is an exterior. ' +
          'A room, a hallway, a bathroom or a balcony seen from inside the property is an interior. ' +
          'Then apply exactly one of the two treatments below and ignore the other completely.',
        'Decide whether this is an interior or an exterior photo, then apply exactly one treatment below.',
      ],
      [`IF EXTERIOR — ${exterior}`, `If exterior: ${exterior}`],
      [`IF INTERIOR — ${interior}`, `If interior: ${interior}`],
      [
        'Never mix the two treatments. Never replace a sky that is not visible, and never add ' +
          'interior lighting effects to an exterior photograph.',
        'Never mix the two.',
      ],
    ],
  }, style);
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
  const style: PromptStyle = ctx.style ?? 'structured';
  const o = ctx.options ?? DEFAULT_OPTIONS;
  switch (task) {
    case 'exterior': return exteriorPrompt(ctx.tageszeit ?? 'Original', o, style);
    case 'interior': return interiorPrompt(ctx.tageszeit ?? 'Normal', o, style);
    case 'auto': return autoPrompt(ctx.tageszeit ?? 'Original', o, style);
    case 'stage-empty': return stagingPrompt('empty', ctx.roomType ?? 'Wohnzimmer', style);
    case 'stage-furnish': return stagingPrompt('furnished', ctx.roomType ?? 'Wohnzimmer', style);
    case 'detail': return detailPrompt(ctx.tageszeit ?? 'Original', style);
    case 'outdoor-furnish': return outdoorFurnishPrompt(style);
    case 'outpaint': return outpaintPrompt(style);
    case 'soften': return softenPrompt(style);
    case 'deglare': return deglarePrompt(style);
    case 'custom': return customPrompt(ctx.userPrompt ?? '', style);
  }
}
